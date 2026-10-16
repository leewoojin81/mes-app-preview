import path from "node:path";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { WEEKLY_YIELD_PROCESSES } from "./weekly-report-shared";
import {
  PRINT_FILL,
  defectTables,
  head,
  para,
  pct,
  qty,
  reportDateLabel,
  run,
  table,
  type Cell,
} from "./weekly-report-docx";
import { patchChart } from "./weekly-report-summary-docx";
import type { MonthlyProductionRow, MonthlyReportResult, MonthlyYieldRow } from "./monthly-report-shared";

// 월간업무보고(PROD-12) Word(.docx) 생성 — 서식 "생산팀 월간 업무.docx"(templates/monthly-report.docx)의 스타일·차트·
// 제목/소제목 문단은 그대로 두고, 값이 들어가는 자리만 새로 채운다(2026-10-16 사용자 요청).
//  - 제목·날짜: 월과 보고일로 바꾼다.
//  - 차트 2개(공정별 생산실적·생산성 / 수율 추이): 차트 캐시 값(+축 범위)을 바꾼다. 서식의 차트는 네트워크 공유폴더의 엑셀을
//    "연결"해 두었는데, 문서를 열어 링크를 갱신하면 우리가 채운 값이 옛 엑셀 값으로 덮이므로 연결을 끊는다(값은 캐시로 표시).
//  - 인쇄공정 표는 서식에서 붙여넣은 그림(EMF)이라 값을 바꿀 수 없어 같은 모양의 실제 Word 표로 다시 그린다.
//  - 월별 수율·주요공정 불량률 표는 Word 표로 새로 그린다(주간업무보고와 같은 모양).
//  - 4. 이슈사항은 사람이 쓰는 내용이라 번호만 남기고 비워 둔다.

export const MONTHLY_REPORT_TEMPLATE_PATH = path.join(process.cwd(), "templates", "monthly-report.docx");

export function monthlyReportFilename(r: MonthlyReportResult): string {
  return `${r.monthNo}월 생산팀 월간 업무.docx`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── 인쇄공정 표 ───────────────────────────────────────────────────────────────
function units(n: number | null): string {
  return n == null ? "" : `${Number.isInteger(n) ? n : n.toFixed(1)} 대`;
}
function printingTable(r: MonthlyReportResult): string {
  const p = r.printing;
  const n = p.weekLabels.length;
  const grid = [1000, 1000, 1100, ...new Array<number>(n).fill(1100), 1300];
  const rows: Cell[][] = [
    [
      head("인쇄기", { vm: "r" }),
      head("구분", { vm: "r" }),
      head(`근무일수 ${p.workDays}일`, { vm: "r" }),
      head(`${r.monthNo}월`, { span: n }),
      head("평균가동대수 생산수량합계", { vm: "r" }),
    ],
    [head("", { vm: "c" }), head("", { vm: "c" }), head("", { vm: "c" }), ...p.weekLabels.map((w) => head(w)), head("", { vm: "c" })],
  ];
  for (const row of p.rows) {
    const fill = row.label === "합계" ? PRINT_FILL : undefined;
    rows.push([
      { t: row.label, bold: true, fill, vm: "r" },
      { t: "가동대수", bold: true, fill },
      { t: units(row.avgUnits), bold: true, fill },
      ...row.units.map((v) => ({ t: units(v), fill })),
      { t: units(row.avgUnits), bold: true, fill },
    ]);
    rows.push([
      { t: "", fill, vm: "c" },
      { t: "생산수량", bold: true, fill },
      { t: qty(row.totalQty), bold: true, fill },
      ...row.qty.map((v) => ({ t: v > 0 ? qty(v) : "-", fill })),
      { t: qty(row.totalQty), bold: true, fill },
    ]);
  }
  return table(grid, rows, { sz: 16, mar: 30 });
}

// ── 월별 수율 표 ──────────────────────────────────────────────────────────────
// 서식: 월별 | 몰드(사출·Base 인쇄·착색 인쇄·정렬) | 렌즈(조립~출하포장 7열) | TTL
const YIELD_HEADS = ["사출", ...WEEKLY_YIELD_PROCESSES.map((p) => p)] as string[];
function yieldTable(r: MonthlyReportResult): string {
  const grid = [800, ...new Array<number>(YIELD_HEADS.length).fill(780), 880];
  const rows: Cell[][] = [
    [head("월별", { vm: "r" }), head("몰드", { span: 4 }), head("렌즈", { span: YIELD_HEADS.length - 4 }), head("TTL", { vm: "r" })],
    [head("", { vm: "c" }), ...YIELD_HEADS.map((h) => head(h)), head("", { vm: "c" })],
  ];
  const line = (y: MonthlyYieldRow): Cell[] => [
    { t: y.monthLabel, bold: true },
    { t: y.injection == null ? "-" : pct(y.injection, 1) },
    ...y.yields.map((v) => ({ t: v == null ? "-" : pct(v, 1) })),
    { t: pct(y.total, 1), bold: true },
  ];
  rows.push(line(r.yield.previous), line(r.yield.current));
  return table(grid, rows, { sz: 16, mar: 30 });
}

// ── 차트 ──────────────────────────────────────────────────────────────────────
const num = (v: number | null) => (v == null ? "" : String(v));
function numCache(format: string, values: (number | null)[]): string {
  return (
    `<c:numCache><c:formatCode>${esc(format)}</c:formatCode><c:ptCount val="${values.length}"/>` +
    values.map((v, i) => (v == null ? "" : `<c:pt idx="${i}"><c:v>${num(v)}</c:v></c:pt>`)).join("") +
    "</c:numCache>"
  );
}
function setScaling(xml: string, axisId: string, min: number | null, max: number | null): string {
  // axisId 축의 <c:scaling>만 바꾼다(축 정의 안에서 axId 뒤쪽이 아니라 앞쪽에 scaling이 있다)
  return xml.replace(new RegExp(`(<c:valAx><c:axId val="${axisId}"/>)<c:scaling>[\\s\\S]*?</c:scaling>`), (_m, head) => {
    return `${head}<c:scaling><c:orientation val="minMax"/>${max != null ? `<c:max val="${max}"/>` : ""}${min != null ? `<c:min val="${min}"/>` : ""}</c:scaling>`;
  });
}

function patchProductionChart(xml: string, rows: MonthlyProductionRow[]): string {
  const k = rows.map((r) => r.qty / 1000);
  const prod = rows.map((r) => r.productivity);
  let i = 0;
  let out = xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (ser) => {
    const values = i === 0 ? k : prod;
    // 생산성은 서식의 0.0%(비율) 표기 대신 "생산량(K천대) ÷ 근무시간" 값 그대로(소수 둘째 자리)
    const fmt = i === 0 ? '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)' : "0.00";
    i++;
    return ser.replace(/<c:val>[\s\S]*?<\/c:val>/, (m) => m.replace(/<c:numCache>[\s\S]*?<\/c:numCache>/, numCache(fmt, values)));
  });
  // 축 범위 — 서식은 값에 맞춰 직접 고정해 둔 값(생산량 1,500~3,000)이라 이번 값에 맞게 다시 잡는다
  const nonNull = k.filter((v) => v > 0);
  if (nonNull.length > 0) {
    const max = Math.ceil((Math.max(...nonNull) * 1.1) / 500) * 500;
    const min = Math.max(0, Math.floor((Math.min(...nonNull) * 0.5) / 500) * 500);
    out = setScaling(out, "1101867856", min, max);
  }
  out = setScaling(out, "1101884656", 0, null);
  return out.replace(/(<c:numFmt formatCode=")0\.0%(" sourceLinked=")1("\/>)/g, "$10.00$20$3");
}

function patchTrendChart(xml: string, points: MonthlyReportResult["yield"]["trend"]): string {
  let out = patchChart(xml, points);
  const vals = points.flatMap((p) => [p.total, p.exInjection]).filter((v): v is number => v != null);
  if (vals.length > 0) {
    const min = Math.max(0, Math.floor((Math.min(...vals) - 0.02) * 50) / 50);
    const max = Math.min(1, Math.ceil((Math.max(...vals) + 0.02) * 50) / 50);
    out = out.replace(/<c:valAx>([\s\S]*?)<c:scaling>[\s\S]*?<\/c:scaling>/, (_m, mid) => {
      return `<c:valAx>${mid}<c:scaling><c:orientation val="minMax"/><c:max val="${max}"/><c:min val="${min}"/></c:scaling>`;
    });
  }
  return out;
}

/** 차트가 네트워크 공유폴더의 엑셀을 가리키는 링크(<c:externalData>)를 끊는다 */
function dropExternalLink(xml: string): string {
  return xml.replace(/<c:externalData[^>]*>[\s\S]*?<\/c:externalData>/, "");
}

// ── 본문 조립 ─────────────────────────────────────────────────────────────────
export async function buildMonthlyReportDocx(r: MonthlyReportResult): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await readFile(MONTHLY_REPORT_TEMPLATE_PATH));
  const docFile = zip.file("word/document.xml");
  const chart1 = zip.file("word/charts/chart1.xml");
  const chart2 = zip.file("word/charts/chart2.xml");
  if (!docFile || !chart1 || !chart2) throw new Error("월간 서식 구조를 찾지 못했습니다.");

  const xml = await docFile.async("string");
  const bodyStart = xml.indexOf("<w:body>") + "<w:body>".length;
  const sectStart = xml.lastIndexOf("<w:sectPr");
  if (bodyStart < "<w:body>".length || sectStart < 0) throw new Error("서식 본문 구조를 찾지 못했습니다.");
  const parts = [...xml.slice(bodyStart, sectStart).matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => m[0]);

  const textOf = (p: string) => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((a) => a[1]).join("");
  const find = (pred: (p: string) => boolean, what: string): number => {
    const i = parts.findIndex(pred);
    if (i < 0) throw new Error(`서식에서 "${what}" 자리를 찾지 못했습니다.`);
    return i;
  };
  const chartRef = (id: string) => (p: string) => new RegExp(`<c:chart [^>]*r:id="${id}"`).test(p);
  const iTitle = find((p) => textOf(p).includes("생산팀 월간 업무"), "제목");
  const iDate = find((p) => /^\s*’\d\d\./.test(textOf(p)), "보고일");
  const iPrint = find((p) => p.includes("<a:blip "), "인쇄공정 그림");
  const iYieldHead = find((p) => textOf(p).replace(/\s/g, "") === "2.생산수율", "2. 생산 수율");
  const iYieldTbl = find((p) => p.startsWith("<w:tbl>") && textOf(p).startsWith("월별"), "월별 수율 표");
  const iDefect1 = find((p) => p.startsWith("<w:tbl>") && textOf(p).startsWith("공정작업량"), "불량 표1");
  const iDefect2 = find((p) => p.startsWith("<w:tbl>") && textOf(p).startsWith("공정불량 유형이물관리"), "불량 표2");
  const iIssueHead = find((p) => textOf(p).includes("이슈사항"), "4. 이슈사항");
  find(chartRef("rId7"), "생산성 차트");
  find(chartRef("rId9"), "수율 차트");

  const out: string[] = [];
  parts.forEach((p, i) => {
    if (i === iTitle) out.push(para(run(`${r.monthNo}월 생산팀 월간 업무`, { size: 36, bold: true, underline: true }), { align: "center" }));
    else if (i === iDate) out.push(para(run(reportDateLabel(r.reportDate), { size: 22 }), { align: "right" }));
    else if (i === iPrint) out.push(printingTable(r));
    else if (i > iPrint && i < iYieldHead) return; // 그림 아래의 빈 줄들 — 표로 바뀌어 높이가 달라지므로 쪽 나눔으로 대체
    else if (i === iYieldHead) out.push(p.replace("<w:pPr>", "<w:pPr><w:pageBreakBefore/>"));
    else if (i === iYieldTbl) out.push(yieldTable(r));
    else if (i === iDefect1) out.push(defectTables(r)[0]);
    else if (i === iDefect2) out.push(defectTables(r)[1]);
    else if (i > iDefect2 && i < iIssueHead) return; // 서식의 빈 줄들
    else if (i > iIssueHead) out.push(p.replace(/(<w:t[^>]*>)\s*(\d\))[^<]*(<\/w:t>)/, "$1 $2 $3")); // 이슈 내용은 비우고 번호만
    else out.push(p);
  });
  // 4. 이슈사항 위에 간격
  const issueAt = out.findIndex((p) => textOf(p).includes("이슈사항"));
  if (issueAt > 0) out.splice(issueAt, 0, para("", { after: 120 }));

  zip.file("word/document.xml", xml.slice(0, bodyStart) + out.join("") + xml.slice(sectStart));
  zip.file("word/charts/chart1.xml", dropExternalLink(patchProductionChart(await chart1.async("string"), r.production)));
  zip.file("word/charts/chart2.xml", dropExternalLink(patchTrendChart(await chart2.async("string"), r.yield.trend)));
  // 차트 관계(rels)에서도 외부 엑셀 연결을 지운다
  for (const n of ["chart1", "chart2"]) {
    const relPath = `word/charts/_rels/${n}.xml.rels`;
    const rel = zip.file(relPath);
    if (rel) zip.file(relPath, (await rel.async("string")).replace(/<Relationship [^>]*relationships\/oleObject"[^>]*\/>/g, ""));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
