import path from "node:path";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import {
  WEEKLY_DEFECT_TABLE1,
  WEEKLY_DEFECT_TABLE2,
  WEEKLY_YIELD_PROCESSES,
  type WeeklyPackagingBlock,
  type WeeklyPackagingRow,
  type WeeklyPlanBlock,
  type WeeklyPrintingBlock,
  type WeeklyReportResult,
} from "./weekly-report-shared";

// 주간업무보고(PROD-11) Word(.docx) 생성 — 원본 서식 "생산팀 주간 업무_38W.docx"
// (templates/weekly-report.docx)의 스타일·테마·페이지 설정을 그대로 두고 본문(<w:body>)만
// 새로 채운다. 서식의 "생산계획 및 실적" 표 3개는 원래 Word 표가 아니라 붙여넣은 그림(EMF/PNG)
// 이라 데이터를 바꿀 수 없어서, 같은 모양의 실제 Word 표로 다시 그린다. 그림 파일과 관계(rels)는
// 패키지에 그대로 남겨 두어도 무해하다(본문에서 더 이상 참조하지 않음).

export const WEEKLY_REPORT_TEMPLATE_PATH = path.join(process.cwd(), "templates", "weekly-report.docx");

const TEXT_WIDTH = 9746; // A4 폭 11906 − 좌우 여백 1080×2 (dxa)

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const FONT = `<w:rFonts w:asciiTheme="minorEastAsia" w:hAnsiTheme="minorEastAsia"/>`;

function run(text: string, o: { size?: number; bold?: boolean; underline?: boolean; color?: string } = {}): string {
  const rpr =
    FONT +
    (o.bold ? "<w:b/><w:bCs/>" : "") +
    (o.color ? `<w:color w:val="${o.color}"/>` : "") +
    (o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : "") +
    (o.underline ? `<w:u w:val="single"/>` : "");
  return `<w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function para(
  runs: string,
  o: { align?: "left" | "center" | "right"; before?: number; after?: number; pageBreakBefore?: boolean } = {}
): string {
  const ppr =
    (o.pageBreakBefore ? "<w:pageBreakBefore/>" : "") +
    (o.before != null || o.after != null
      ? `<w:spacing${o.before != null ? ` w:before="${o.before}"` : ""}${o.after != null ? ` w:after="${o.after}"` : ""}/>`
      : "") + (o.align ? `<w:jc w:val="${o.align}"/>` : "");
  return `<w:p><w:pPr>${ppr}</w:pPr>${runs}</w:p>`;
}

// 표 칸 문단 — 글자가 있든 없든(빈 칸 포함) 문단 글꼴 크기와 줄간격을 같게 고정해 줄 높이가
// 균일하게 나온다. 예전엔 빈 칸의 빈 문단이 본문 기본 글꼴 크기를 따라 빈 칸이 있는 줄만 더 높았다
// (2026-10-01 사용자 요청 — 주요공정 불량률 줄간격 균일화).
function cellPara(c: Cell, sz: number): string {
  const markRpr = `<w:rPr>${FONT}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
  const ppr =
    `<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>` +
    `<w:jc w:val="${c.align ?? "center"}"/>` +
    markRpr;
  const runs = c.t ? run(c.t, { size: sz, bold: c.bold, color: c.color }) : "";
  return `<w:p><w:pPr>${ppr}</w:pPr>${runs}</w:p>`;
}

interface Cell {
  t: string;
  span?: number;
  /** "r" = 세로 병합 시작, "c" = 세로 병합 이어짐 */
  vm?: "r" | "c";
  fill?: string;
  bold?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
}

const BORDERS = ["top", "left", "bottom", "right"]
  .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
  .join("");

function table(grid: number[], rows: Cell[][], opts: { sz?: number; mar?: number } = {}): string {
  const sz = opts.sz ?? 18;
  const mar = opts.mar ?? 40;
  const total = grid.reduce((s, v) => s + v, 0);
  const scale = TEXT_WIDTH / total;
  const g = grid.map((w) => Math.round(w * scale));
  let xml =
    `<w:tbl><w:tblPr><w:tblW w:w="${TEXT_WIDTH}" w:type="dxa"/><w:jc w:val="center"/>` +
    `<w:tblBorders>${BORDERS}<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="${mar}" w:type="dxa"/><w:right w:w="${mar}" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${g.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
  for (const row of rows) {
    xml += `<w:tr><w:trPr><w:trHeight w:val="330"/></w:trPr>`;
    let col = 0;
    for (const c of row) {
      const span = c.span ?? 1;
      const w = g.slice(col, col + span).reduce((s, v) => s + v, 0);
      col += span;
      xml +=
        `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>` +
        (span > 1 ? `<w:gridSpan w:val="${span}"/>` : "") +
        (c.vm === "r" ? `<w:vMerge w:val="restart"/>` : c.vm === "c" ? `<w:vMerge/>` : "") +
        (c.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${c.fill}"/>` : "") +
        `<w:vAlign w:val="center"/></w:tcPr>` +
        cellPara(c, sz) +
        `</w:tc>`;
    }
    xml += `</w:tr>`;
  }
  return xml + `</w:tbl>`;
}

const HEAD_FILL = "F2F2F2";
const SUM_FILL = "FFF2CC";

function head(t: string, extra: Partial<Cell> = {}): Cell {
  return { t, bold: true, fill: HEAD_FILL, ...extra };
}
function qty(n: number | null): string {
  return n == null ? "" : Math.round(n).toLocaleString("ko-KR");
}
function pct(n: number | null, digits: number): string {
  return n == null ? "" : `${(n * 100).toFixed(digits)}%`;
}
// 불량유형 칸은 0.000001% 미만(사실상 없음)이면 빈칸(2026-10-01 사용자 요청)
function defectPct(n: number | null): string {
  return n == null || n * 100 < 0.000001 ? "" : pct(n, 2);
}
function signedCell(n: number | null, fill?: string): Cell {
  return { t: qty(n), color: n != null && n < 0 ? "FF0000" : undefined, fill };
}

function planTable(b: WeeklyPlanBlock, monthNo: number): string {
  const n = b.columns.length;
  // 주차 구간("09/25~10/01")과 7자리 수량이 9pt에서 한 줄에 들어가도록 열 폭을 배분한다.
  const grid = [620, 1450, ...new Array<number>(n * 4).fill(n === 2 ? 959 : 1900)];
  const groups = ["계획(월)", "실적", "계획대비실적", "달성률(%)"];
  const rows: Cell[][] = [
    [
      head(`${monthNo}월 ${b.title} 계획`, { span: 2, vm: "r" }),
      ...groups.map((g) => head(g, { span: n })),
    ],
    [head("", { span: 2, vm: "c" }), ...groups.flatMap(() => b.columns.map((c) => head(c)))],
  ];
  for (const w of b.weeks) {
    rows.push([
      { t: w.weekLabel, bold: true },
      { t: w.rangeLabel },
      ...w.plan.map((v) => ({ t: qty(v) })),
      ...w.actual.map((v) => ({ t: qty(v) })),
      ...w.diff.map((v) => signedCell(v)),
      ...w.rate.map((v) => ({ t: pct(v, 2) })),
    ]);
  }
  const m = b.month;
  rows.push([
    { t: m.label, bold: true, fill: SUM_FILL },
    { t: m.rangeLabel, fill: SUM_FILL },
    ...m.plan.map((v) => ({ t: qty(v), bold: true, fill: SUM_FILL })),
    ...m.actual.map((v) => ({ t: qty(v), bold: true, fill: SUM_FILL })),
    ...m.diff.map((v) => ({ ...signedCell(v, SUM_FILL), bold: true })),
    ...m.rate.map((v) => ({ t: pct(v, 2), bold: true, fill: SUM_FILL })),
  ]);
  return table(grid, rows);
}

// 출하공정.JPG(포장계획.JPG) 표 — 주차별 기초계획(월)·포장 실적·계획대비실적·달성률을 팩수/수량으로(화면과 동일).
// 0이면 "-", 아직 시작하지 않은 주차(null)는 빈칸.
function dashQty(n: number | null): string {
  if (n == null) return "";
  const r = Math.round(n);
  return r === 0 ? "-" : r.toLocaleString("ko-KR");
}
function packagingTable(b: WeeklyPackagingBlock): string {
  // 7자리 수량("1,250,540")이 8pt에서 한 줄에 들어가도록 숫자 열을 같은 폭으로 잡는다.
  const grid = [680, 1250, ...new Array<number>(8).fill(980)];
  const groups = ["기초계획(월)", "포장 실적", "계획대비실적", "달성률(%)"];
  const rows: Cell[][] = [
    [head("주차별", { vm: "r" }), head("기간", { vm: "r" }), ...groups.map((g) => head(g, { span: 2 }))],
    [head("", { vm: "c" }), head("", { vm: "c" }), ...groups.flatMap(() => [head("팩수"), head("수량")])],
  ];
  const line = (w: WeeklyPackagingRow, fill?: string): Cell[] => {
    const bold = !!fill;
    const diff = (n: number | null): Cell => ({ ...signedCell(n, fill), t: dashQty(n), bold });
    return [
      { t: w.weekLabel, bold: true, fill },
      { t: w.rangeLabel, bold, fill },
      { t: dashQty(w.planPacks), bold, fill },
      { t: dashQty(w.planQty), bold, fill },
      { t: dashQty(w.actualPacks), bold, fill },
      { t: dashQty(w.actualQty), bold, fill },
      diff(w.diffPacks),
      diff(w.diffQty),
      { t: pct(w.ratePacks, 1), bold, fill },
      { t: pct(w.rateQty, 1), bold, fill },
    ];
  };
  for (const w of b.weeks) rows.push(line(w));
  rows.push(line(b.month, PRINT_FILL));
  return table(grid, rows, { sz: 16, mar: 30 });
}

const PRINT_FILL = "FCE4D6";

// 가동대수는 소수 첫째 자리까지, 단위("대") 없이 표시한다(화면과 동일).
function units(n: number | null): string {
  return n == null ? "" : n.toFixed(1);
}

// 인쇄공정.JPG 표 — 수동/자동 인쇄기별 가동대수·생산수량(전주 합계 + 당주 일별 + 평균/합계)
function printingTable(p: WeeklyPrintingBlock): string {
  // 날짜·"주간 합계"가 한 줄에 들어가도록 이 표만 글씨(7.5pt)와 열 폭을 따로 잡는다.
  // 인쇄기·구분·전주·요일 7열·주간 합계 11열을 모두 같은 폭으로 맞춘다(라벨이 "수동"/"자동"으로
  // 짧아져 균일 폭에서도 한 줄에 들어간다).
  const grid = new Array<number>(p.dates.length + 4).fill(880);
  const rows: Cell[][] = [
    [
      head("인쇄기", { vm: "r" }),
      head("구분", { vm: "r" }),
      head(p.prevWeekLabel),
      head(p.weekLabel, { span: p.dates.length }),
      head("주간 합계", { vm: "r" }),
    ],
    [
      head("", { vm: "c" }),
      head("", { vm: "c" }),
      head(`${p.prevWorkDays}일 근무`),
      ...p.dates.map((d) => head(`${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`)),
      head("", { vm: "c" }),
    ],
  ];
  for (const r of p.rows) {
    const fill = r.label === "합계" ? PRINT_FILL : undefined;
    rows.push([
      { t: r.label.replace("인쇄기", ""), bold: true, fill, vm: "r" }, // 다운로드에서는 "수동"/"자동"으로 줄여 표시
      { t: "생산수량", bold: true, fill },
      { t: qty(r.prevQty), bold: true, fill },
      ...r.qty.map((v) => ({ t: v > 0 ? qty(v) : "-", fill })),
      { t: qty(r.totalQty), bold: true, fill },
    ]);
    rows.push([
      { t: "", fill, vm: "c" },
      { t: "가동대수", bold: true, fill },
      { t: units(r.prevAvgUnits), bold: true, fill },
      ...r.units.map((v) => ({ t: units(v), fill })),
      { t: units(r.avgUnits), bold: true, fill },
    ]);
  }
  return table(grid, rows, { sz: 15, mar: 30 });
}

function progressLine(b: WeeklyPlanBlock): string {
  if (b.capaMissing) return "☞ 계획정보(PLAN-02)에 이 공정의 일CAPA가 등록되지 않아 계획·달성율을 계산하지 못했습니다.";
  return (
    `☞ 근무일(${b.totalWorkDays}일)수 대비 ${b.elapsedWorkDays}일 경과_ ` +
    `계획 진도율: ${pct(b.progressRate, 1)},  달성율 ${pct(b.achievementRate, 1)}`
  );
}

function yieldTable(r: WeeklyReportResult): string {
  const procs = WEEKLY_YIELD_PROCESSES;
  const grid = [700, 800, ...new Array<number>(procs.length).fill(760), 800];
  const rows: Cell[][] = [
    [head("공정", { vm: "r" }), head("몰드"), head("렌즈", { span: procs.length }), head("TTL", { vm: "r" })],
    [head("", { vm: "c" }), head("사출"), ...procs.map((p) => head(p)), head("", { vm: "c" })],
  ];
  for (const y of [r.yield.previous, r.yield.current]) {
    rows.push([
      { t: y.weekLabel, bold: true },
      { t: y.injection == null ? "-" : pct(y.injection, 1) },
      ...y.yields.map((v) => ({ t: v == null ? "-" : pct(v, 1) })),
      { t: pct(y.total, 1), bold: true },
    ]);
  }
  return table(grid, rows);
}

function yieldLine(label: string, cur: number | null, prev: number | null, diff: number | null): string | null {
  if (cur == null) return null;
  let s = `${label} : ${pct(cur, 1)}`;
  if (prev != null && diff != null) {
    const d = Math.abs(diff * 100).toFixed(1);
    const dir = Math.abs(diff) < 0.0005 ? "동일" : diff > 0 ? `${d}% 증가` : `${d}% 감소`;
    s += ` (전주 : ${pct(prev, 1)} 전주 比 ${dir})`;
  }
  return s;
}

function yieldSummary(r: WeeklyReportResult): string {
  const y = r.yield;
  const s = yieldLine("당주", y.current.total, y.previous.total, y.diffPct);
  return s ? `□ ${s}` : "□ 당주 : 해당 주차 수율 데이터가 없습니다.";
}

function yieldExInjectionSummary(r: WeeklyReportResult): string | null {
  const y = r.yield;
  const s = yieldLine("사출제외 : 당주", y.current.totalExInjection, y.previous.totalExInjection, y.diffPctExInjection);
  return s ? `☞ ${s}` : null;
}

function defectTables(r: WeeklyReportResult): string[] {
  const t1 = WEEKLY_DEFECT_TABLE1;
  const grid1 = [900, 1000, 1000, 1000, 800, ...new Array<number>(t1.length).fill(900)];
  const rows1: Cell[][] = [
    [
      head("공정", { vm: "r" }),
      head("작업량(K천대)", { vm: "r" }),
      head("양품수(K천대)", { vm: "r" }),
      head("불량수(K천대)", { vm: "r" }),
      head("YLD", { vm: "r" }),
      head("불량 유형", { span: t1.length }),
    ],
    [head("", { vm: "c" }), head("", { vm: "c" }), head("", { vm: "c" }), head("", { vm: "c" }), head("", { vm: "c" }), ...t1.map((c) => head(c.title))],
  ];
  const k = (n: number): string => Math.round(n / 1000).toLocaleString("ko-KR");
  for (const d of r.defect) {
    rows1.push([
      { t: d.label, bold: true },
      { t: k(d.workQty) },
      { t: k(d.goodQty) },
      { t: k(d.badQty) },
      { t: pct(d.yld, 1) },
      ...d.table1.map((v) => ({ t: defectPct(v) })),
    ]);
  }

  const t2 = WEEKLY_DEFECT_TABLE2;
  const grid2 = [900, ...new Array<number>(t2.length).fill(850), 1500];
  const groupCells: Cell[] = [];
  for (let i = 0; i < t2.length; ) {
    let j = i;
    while (j < t2.length && t2[j].group === t2[i].group) j++;
    groupCells.push(head(t2[i].group, { span: j - i }));
    i = j;
  }
  const rows2: Cell[][] = [
    [head("공정", { vm: "r" }), ...groupCells, head("비고(%)", { vm: "r" })],
    [head("", { vm: "c" }), ...t2.map((c) => head(c.title)), head("", { vm: "c" })],
  ];
  for (const d of r.defect) {
    rows2.push([{ t: d.label, bold: true }, ...d.table2.map((v) => ({ t: defectPct(v) })), { t: d.note }]);
  }
  return [table(grid1, rows1), table(grid2, rows2)];
}

function reportDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, m - 1, d).getDay()];
  return `’${String(y).slice(2)}. ${String(m).padStart(2, "0")}. ${String(d).padStart(2, "0")} (${wd})`;
}

export function weeklyReportFilename(r: WeeklyReportResult): string {
  return `생산팀 주간 업무_${r.weekNo}W.docx`;
}

export async function buildWeeklyReportDocx(r: WeeklyReportResult): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await readFile(WEEKLY_REPORT_TEMPLATE_PATH));
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("서식에 word/document.xml이 없습니다.");
  const xml = await docFile.async("string");
  const bodyStart = xml.indexOf("<w:body>");
  const sectStart = xml.lastIndexOf("<w:sectPr");
  if (bodyStart < 0 || sectStart < 0) throw new Error("서식 본문 구조를 찾지 못했습니다.");

  const monthNo = Number(r.yearMonth.slice(5, 7));
  const parts: string[] = [];
  parts.push(para(run(`${r.weekNo}주차 생산팀 주간 업무`, { size: 36, bold: true, underline: true }), { align: "center" }));
  parts.push(para(run(reportDateLabel(r.reportDate), { size: 22 }), { align: "right" }));

  parts.push(para(run("1. 생산계획 및 실적", { size: 28, bold: true }), { before: 120 }));
  // 서식 순서: 사출 → 인쇄 → 출하 (☞ 진도율 문구는 서식대로 사출에만 붙는다)
  const block = (title: string, inner: string, note?: string) => {
    parts.push(para(run("□ ", { size: 24, bold: true }) + run(`${title}공정`, { size: 24 }), { before: 80 }));
    parts.push(inner);
    if (note) parts.push(para(run(note, { size: 24 }), { before: 40 }));
  };
  const injection = r.plan.find((b) => b.key === "injection");
  if (injection) block("사출", planTable(injection, monthNo), progressLine(injection));
  block("인쇄", printingTable(r.printing));
  block("출하", packagingTable(r.packaging));

  // 2. 생산공정 수율부터는 Word 2페이지에서 시작한다(2026-10-02 사용자 요청)
  parts.push(para(run("2. 생산공정 수율", { size: 28, bold: true }), { pageBreakBefore: true }));
  parts.push(para(run(yieldSummary(r), { size: 24 })));
  parts.push(yieldTable(r));
  const exInjection = yieldExInjectionSummary(r);
  if (exInjection) parts.push(para(run(exInjection, { size: 24 })));

  parts.push(para(run("3. 주요공정 불량률", { size: 28, bold: true }), { before: 200 }));
  for (const t of defectTables(r)) {
    parts.push(t);
    parts.push(para("", { after: 60 }));
  }

  const next = xml.slice(0, bodyStart + "<w:body>".length) + parts.join("") + xml.slice(sectStart);
  zip.file("word/document.xml", next);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
