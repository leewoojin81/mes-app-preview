import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { extractWoNo, lookupWorkOrder } from "@/lib/mobile-defect";

export const runtime = "nodejs";

// 모바일 불량입력(/m/defect) — QR 판독값(또는 직접 입력한 번호)으로 작업지시·품목·LOT 조회
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("q") ?? "";
  const woNo = extractWoNo(raw);
  if (!woNo) {
    return NextResponse.json(
      { error: "작업지시번호 형식(PR + 숫자 12자리)이 아닙니다.", raw },
      { status: 400 }
    );
  }
  const found = lookupWorkOrder(getDb(), woNo);
  if (!found) {
    return NextResponse.json(
      { error: `${woNo} 작업지시를 찾을 수 없습니다. ERP 작업지시현황 업로드 전일 수 있습니다.`, wo_no: woNo },
      { status: 404 }
    );
  }
  return NextResponse.json(found);
}
