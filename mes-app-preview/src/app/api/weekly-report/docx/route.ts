import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computeWeeklyReport, defaultWeekStart } from "@/lib/weekly-report";
import { buildWeeklyReportDocx, weeklyReportFilename } from "@/lib/weekly-report-docx";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 주간업무보고(PROD-11) Word 다운로드 — 서식 templates/weekly-report.docx에 집계 결과를 채워
// .docx(MS Word)로 내려준다(2026-09-29 사용자 요청: 앞으로 다운로드는 Word 형식).
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (date && !DATE_RE.test(date)) {
    return NextResponse.json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  const result = computeWeeklyReport(getDb(), date ?? defaultWeekStart(todayStr()));
  let buffer: Buffer;
  try {
    buffer = await buildWeeklyReportDocx(result);
  } catch (e) {
    return NextResponse.json(
      { error: `서식 파일을 처리하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }
  const filename = weeklyReportFilename(result);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
