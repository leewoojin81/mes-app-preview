import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getDb } from "@/lib/db";
import { computeLineCapaPlan } from "@/lib/production-plan-lines";

export const runtime = "nodejs";

const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

// 계획정보(PLAN-02) "공정별 월 CAPA 및 근무계획" 엑셀 다운로드 — 첨부받은 생산계획.xlsx의
// "3. 공정별 월 CAPA 및 근무계획" 표(라인별/인원/근무시간/근무일수/공정별 계획(Day·Month
// 병합헤더)/생산성(UPH)/합계 행)와 같은 배치로 내려주고, 그 원본엔 없던 "비고"(간접직
// 소속 인원 텍스트) 컬럼을 하나 더 붙인다(2026-09-13 사용자 요청).
export async function GET(req: NextRequest) {
  const yearMonth = req.nextUrl.searchParams.get("yearMonth");
  if (!yearMonth || !YEAR_MONTH_RE.test(yearMonth)) {
    return NextResponse.json({ error: "yearMonth는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
  }
  const db = getDb();
  const result = computeLineCapaPlan(db, yearMonth);
  const [, monthStr] = yearMonth.split("-");
  const monthLabel = String(Number(monthStr));

  const fmt = (n: number | null, digits = 0) =>
    n == null ? "-" : Number(n.toFixed(digits)).toLocaleString("ko-KR");

  // 사출_상/사출_하는 같은 사출(P100) 인원이 담당하는 한 라인이라 인원·근무시간·근무일수가
  // 항상 같다(2026-09-13 사용자 요청) — 화면(page.tsx LineCapaPlanTab)과 맞춰 엑셀도 두 행에
  // 걸쳐 병합한다. "생산성(UPH)"도 같은 이유로 병합하되 두 라인의 일CAPA를 합쳐서 같은
  // 인원 기준으로 다시 계산한다. "공정별 계획"(일CAPA)은 라인마다 달라 병합하지 않는다.
  const upperIdx = result.rows.findIndex((r) => r.key === "injection_upper");
  const lowerIdx = result.rows.findIndex((r) => r.key === "injection_lower");
  const mergeInjectionStats = upperIdx >= 0 && lowerIdx === upperIdx + 1;
  const upperRow = mergeInjectionStats ? result.rows[upperIdx] : undefined;
  const lowerRow = mergeInjectionStats ? result.rows[lowerIdx] : undefined;
  const mergedInjectionUph =
    upperRow && (upperRow.dailyCapa != null || lowerRow?.dailyCapa != null) && upperRow.headcount > 0
      ? ((upperRow.dailyCapa ?? 0) + (lowerRow?.dailyCapa ?? 0)) / (upperRow.headcount * upperRow.hoursPerDay)
      : null;

  const dataRows = result.rows.map((r, i) => [
    r.label,
    mergeInjectionStats && i === lowerIdx ? "" : `${r.headcount} 명`,
    mergeInjectionStats && i === lowerIdx ? "" : `${r.hoursPerDay.toFixed(2)} hr`,
    mergeInjectionStats && i === lowerIdx ? "" : `${r.workDays} 일`,
    fmt(r.dailyCapa),
    fmt(r.monthlyCapa),
    mergeInjectionStats && i === lowerIdx
      ? ""
      : mergeInjectionStats && i === upperIdx
        ? mergedInjectionUph == null
          ? "-"
          : fmt(mergedInjectionUph, 1)
        : r.uph == null
          ? "-"
          : fmt(r.uph, 1),
    r.remark ?? r.defaultRemark ?? "-",
  ]);

  const aoa: (string | number)[][] = [
    [`${monthLabel}월 공정별 월 CAPA 및 근무계획`, "", "", "", "", "", "", ""],
    ["라인별", "인원", "근무시간", "근무일수", "공정별 계획", "", "생산성(UPH)", "비고"],
    ["", "", "", "", "Day", "Month", "", ""],
    ...dataRows,
    [
      "합계",
      `${result.totals.headcount} 명`,
      `${result.rows[0]?.hoursPerDay.toFixed(2) ?? "8.00"} hr`,
      `${result.rows[0]?.workDays ?? 0} 일`,
      fmt(result.totals.dailyCapa),
      fmt(result.totals.monthlyCapa),
      result.totals.uph == null ? "-" : fmt(result.totals.uph, 2),
      "",
    ],
  ];

  const HEADER_ROWS = 3;
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },
    { s: { r: 1, c: 1 }, e: { r: 2, c: 1 } },
    { s: { r: 1, c: 2 }, e: { r: 2, c: 2 } },
    { s: { r: 1, c: 3 }, e: { r: 2, c: 3 } },
    { s: { r: 1, c: 4 }, e: { r: 1, c: 5 } },
    { s: { r: 1, c: 6 }, e: { r: 2, c: 6 } },
    { s: { r: 1, c: 7 }, e: { r: 2, c: 7 } },
    ...(mergeInjectionStats
      ? [1, 2, 3, 6].map((c) => ({
          s: { r: HEADER_ROWS + upperIdx, c },
          e: { r: HEADER_ROWS + lowerIdx, c },
        }))
      : []),
  ];
  ws["!cols"] = [
    { wch: 10 },
    { wch: 8 },
    { wch: 10 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 30 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${yearMonth}`);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const filename = `${yearMonth}_공정별월CAPA및근무계획.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
