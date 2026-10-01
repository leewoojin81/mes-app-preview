import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { importBizRows, parseBizSheet } from "@/lib/biz-attendance";

export const runtime = "nodejs";

// 비즈 "기간별 근무관리" 엑셀(비즈.xlsx) 업로드 — 관리자만. 파일의 출근일자 최소~최대 구간의 기존
// 데이터를 지우고 파일 내용으로 새로 채운다(구간 재동기화). 소계 행은 저장하지 않는다.
export async function POST(req: NextRequest) {
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (session?.r !== "admin") {
    return NextResponse.json({ error: "업로드는 관리자만 할 수 있습니다." }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
  }
  let rows: unknown[][];
  try {
    const wb = XLSX.read(Buffer.from(await file.arrayBuffer()));
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true }) as unknown[][];
  } catch {
    return NextResponse.json(
      { error: "엑셀 파일을 읽을 수 없습니다. (.xlsx/.xls 파일인지 확인하세요)" },
      { status: 400 }
    );
  }
  const parsed = parseBizSheet(rows);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.rows.length === 0) {
    return NextResponse.json({ error: "유효한 데이터(사번·출근일자)가 없습니다." }, { status: 400 });
  }
  const result = importBizRows(getDb(), parsed.rows);
  return NextResponse.json({ ...result, skipped: parsed.skipped });
}
