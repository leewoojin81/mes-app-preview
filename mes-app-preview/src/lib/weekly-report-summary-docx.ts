import path from "node:path";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import type { WeeklyReportResult } from "@/lib/weekly-report-shared";
import type { SummaryYieldPoint, WeeklySummary } from "@/lib/weekly-report";
import { reportDateLabel } from "@/lib/weekly-report-docx";

// PROD-11 "요약 다운로드"(2026-10-14 사용자 요청) — 서식 "생산팀 주간 업무_41W_요약.docx"
// (templates/weekly-report-summary.docx)의 {{WEEK}}/{{DATE}}/{{UPPER}}/{{LOWER}}/{{PRINT}}/{{SHIP}} 자리와
// 수율 차트 캐시를 채운다. 이슈·주요이슈는 수기 항목이라 비워 둔다.
export const WEEKLY_SUMMARY_TEMPLATE_PATH = path.join(process.cwd(), "templates", "weekly-report-summary.docx");

export function weeklySummaryFilename(r: WeeklyReportResult): string {
  return `생산팀 주간 업무_${r.weekNo}W_요약.docx`;
}

const nf = (n: number) => Math.round(n).toLocaleString("ko-KR");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 막대(사출포함) 점별 색: 분기 = 연한 녹색, 주차 = 노랑, 월 = 시리즈 기본색.
function pointFill(kind: SummaryYieldPoint["kind"]): string | null {
  if (kind === "quarter") return '<a:schemeClr val="accent6"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>';
  if (kind === "week") return '<a:srgbClr val="FFC000"/>';
  return null;
}

export function patchChart(xml: string, points: SummaryYieldPoint[]): string {
  const strCache =
    `<c:strCache><c:ptCount val="${points.length}"/>` +
    points.map((p, i) => `<c:pt idx="${i}"><c:v>${esc(p.label)}</c:v></c:pt>`).join("") +
    "</c:strCache>";
  const numCache = (pick: (p: SummaryYieldPoint) => number | null) =>
    `<c:numCache><c:formatCode>0.0%</c:formatCode><c:ptCount val="${points.length}"/>` +
    points
      .map((p, i) => {
        const v = pick(p);
        return v == null ? "" : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`;
      })
      .join("") +
    "</c:numCache>";
  const dPts = points
    .map((p, i) => {
      const fill = pointFill(p.kind);
      return fill
        ? `<c:dPt><c:idx val="${i}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr><a:solidFill>${fill}</a:solidFill><a:ln><a:noFill/></a:ln><a:effectLst/></c:spPr></c:dPt>`
        : "";
    })
    .join("");

  let serIdx = 0;
  return xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (ser) => {
    const pick = serIdx === 0 ? (p: SummaryYieldPoint) => p.total : (p: SummaryYieldPoint) => p.exInjection;
    serIdx++;
    let out = ser
      .replace(/<c:cat>[\s\S]*?<\/c:cat>/, (m) => m.replace(/<c:strCache>[\s\S]*?<\/c:strCache>/, strCache))
      .replace(/<c:val>[\s\S]*?<\/c:val>/, (m) => m.replace(/<c:numCache>[\s\S]*?<\/c:numCache>/, numCache(pick)));
    if (/<c:dPt>/.test(out)) {
      // 기존 점별 서식을 모두 걷어내고 새 구간에 맞게 다시 넣는다(막대 시리즈에만 있음).
      out = out.replace(/<c:dPt>[\s\S]*?<\/c:dPt>/g, "");
      out = out.replace(/(<c:invertIfNegative val="0"\/>)/, `$1${dPts}`);
    }
    return out;
  });
}

export async function buildWeeklySummaryDocx(r: WeeklyReportResult, s: WeeklySummary): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await readFile(WEEKLY_SUMMARY_TEMPLATE_PATH));
  const docFile = zip.file("word/document.xml");
  const chartFile = zip.file("word/charts/chart1.xml");
  if (!docFile || !chartFile) throw new Error("요약 서식 구조를 찾지 못했습니다.");

  const fills: Record<string, string> = {
    "{{WEEK}}": String(r.weekNo),
    "{{DATE}}": reportDateLabel(r.reportDate),
    "{{UPPER}}": nf(s.upperQty),
    "{{LOWER}}": nf(s.lowerQty),
    "{{PRINT}}": nf(s.printQty),
    "{{SHIP}}": nf(s.shipQty),
  };
  let doc = await docFile.async("string");
  for (const [k, v] of Object.entries(fills)) doc = doc.split(k).join(esc(v));
  zip.file("word/document.xml", doc);
  zip.file("word/charts/chart1.xml", patchChart(await chartFile.async("string"), s.yieldTrend));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
