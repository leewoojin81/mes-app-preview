import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computeMonthlyReport, defaultReportMonth } from "@/lib/monthly-report";
import { buildMonthlyReportDocx, monthlyReportFilename } from "@/lib/monthly-report-docx";

export const runtime = "nodejs";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 월간업무보고(PROD-12) Word 다운로드 — 서식 templates/monthly-report.docx(생산팀 월간 업무.docx)를 채운다.
export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  if (month && !MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
  }
  const result = computeMonthlyReport(getDb(), month ?? defaultReportMonth(todayStr()));
  let buffer: Buffer;
  try {
    buffer = await buildMonthlyReportDocx(result);
  } catch (e) {
    return NextResponse.json(
      { error: `서식 파일을 처리하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }
  const filename = monthlyReportFilename(result);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
