import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { BIZ_AUDIT_ITEM_KEYS, BIZ_AUDIT_ITEM_LABELS, fetchBizAudit } from "@/lib/biz-audit";

export const runtime = "nodejs";

// 비즈 대사 엑셀 다운로드 — 화면과 같은 조건의 대조 결과(기본은 차이가 있는 행만, onlyDiff=0이면 전체).
// 시간은 "H:MM" 문자열이 아니라 엑셀 [h]:mm 시간값으로 넣어 합계/필터에 바로 쓸 수 있게 한다.
function clock(min: number): XLSX.CellObject {
  return { t: "n", v: min / 1440, z: "[h]:mm" };
}
function diffClock(min: number): XLSX.CellObject {
  return min === 0 ? { t: "s", v: "" } : { t: "s", v: `${min < 0 ? "-" : "+"}${Math.floor(Math.abs(min) / 60)}:${String(Math.abs(min) % 60).padStart(2, "0")}` };
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
  const result = fetchBizAudit(getDb(), {
    dateFrom,
    dateTo,
    workGroup: params.get("workGroup") ?? "",
    q: params.get("q") ?? "",
    leaderWorkGroups,
  });
  const onlyDiff = params.get("onlyDiff") !== "0";
  const cause = params.get("cause") ?? "";
  const rows = result.rows.filter((r) => (!onlyDiff || r.status !== "일치") && (!cause || r.causes.includes(cause)));
  if (rows.length === 0) {
    return NextResponse.json({ error: "다운로드할 데이터가 없습니다." }, { status: 404 });
  }

  const header: string[] = ["사번", "비즈사번", "성명", "공정", "비즈부서", "일자", "타임", "출근시간", "퇴근시간"];
  for (const k of BIZ_AUDIT_ITEM_KEYS) header.push(`${BIZ_AUDIT_ITEM_LABELS[k]} 비즈`, `${BIZ_AUDIT_ITEM_LABELS[k]} MES`, `${BIZ_AUDIT_ITEM_LABELS[k]} 차이`);
  header.push("상태", "사유", "비즈 비고");

  const ws: XLSX.WorkSheet = {};
  header.forEach((h, c) => (ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: "s", v: h }));
  rows.forEach((r, i) => {
    const line: (XLSX.CellObject | string | null)[] = [
      r.employee_no, r.biz_no, r.worker_name, r.work_group, r.dept, r.work_date, r.shift, r.in_time, r.out_time,
    ];
    for (const k of BIZ_AUDIT_ITEM_KEYS) {
      const it = r.items[k];
      line.push(clock(it.biz), clock(it.mes), diffClock(it.mismatch ? it.diff : 0));
    }
    line.push(r.status, r.causes.join(", "), r.note);
    line.forEach((v, c) => {
      if (v == null || v === "") return;
      ws[XLSX.utils.encode_cell({ r: i + 1, c })] = typeof v === "string" ? { t: "s", v } : v;
    });
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } });
  ws["!cols"] = header.map((h) => ({ wch: h === "사유" ? 36 : h === "성명" || h.endsWith("차이") ? 11 : 10 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "비즈 대사");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = `비즈대사_${dateFrom.replace(/-/g, "")}-${dateTo.replace(/-/g, "")}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
    },
  });
}
