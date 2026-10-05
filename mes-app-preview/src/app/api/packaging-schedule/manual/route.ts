import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { fetchManualSchedule, importManualSchedule, parseManualWorkbook } from "@/lib/packaging-manual-schedule";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 계획정보(PLAN-03) "일정(수기)" — 업로드한 엑셀 일정을 시작일부터 days일 동안 내려준다.
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const days = Math.min(62, Math.max(1, parseInt(req.nextUrl.searchParams.get("days") ?? "28", 10) || 28));
  if (!from || !DATE_RE.test(from)) {
    return NextResponse.json({ error: "from은 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  return NextResponse.json(fetchManualSchedule(getDb(), from, days));
}

// 엑셀 업로드 — "2026년 포장" 엑셀의 1번 시트(설비·구분 머리글 + 날짜 열)를 읽어, 파일의 날짜 구간에 있던 기존 수기 일정을 바꾼다.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
  }
  let parsed;
  try {
    parsed = parseManualWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "엑셀 파일을 읽을 수 없습니다." }, { status: 400 });
  }
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const r = importManualSchedule(getDb(), parsed, file.name, session?.u ?? null);
  return NextResponse.json({
    ...r,
    sheet: parsed.sheetName,
    dateFrom: parsed.dateFrom,
    dateTo: parsed.dateTo,
    withSoNo: parsed.cells.filter((c) => c.so_no).length,
  });
}
