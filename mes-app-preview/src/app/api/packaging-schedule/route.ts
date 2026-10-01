import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { fetchPackagingSchedule, PACKAGING_LINES, savePackagingSoNo } from "@/lib/packaging-schedule";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 62;

// 계획정보(PLAN-03) "출하포장" — 시작일부터 days일 동안의 라인×일자 포장 계획과 실적을 내려준다. 고객사·품목군·계획·
// 개입수·납기일은 칸의 수주번호로 수주등록·거래처정보·제품정보에서 읽어 채워서 내려준다.
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const days = Math.min(MAX_DAYS, Math.max(1, parseInt(req.nextUrl.searchParams.get("days") ?? "28", 10) || 28));
  if (!from || !DATE_RE.test(from)) {
    return NextResponse.json({ error: "from은 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  return NextResponse.json(fetchPackagingSchedule(getDb(), from, days));
}

interface PatchBody {
  planDate?: string;
  lineKey?: string;
  soNo?: string | null;
}

// 한 칸(라인·일자)의 수주번호를 저장한다 — 직접 입력하는 값은 수주번호뿐이다(2026-10-02 사용자 요청). 번호를 지우면
// 그 칸의 읽어 온 값도 함께 지워진다.
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as PatchBody | null;
  const planDate = body?.planDate?.trim();
  const lineKey = body?.lineKey?.trim();
  if (!planDate || !DATE_RE.test(planDate) || !lineKey || !PACKAGING_LINES.some((l) => l.key === lineKey)) {
    return NextResponse.json({ error: "planDate(YYYY-MM-DD)와 올바른 lineKey가 필요합니다." }, { status: 400 });
  }
  if (!body || !Object.prototype.hasOwnProperty.call(body, "soNo")) {
    return NextResponse.json({ error: "soNo가 필요합니다. 수주번호 외의 값은 직접 입력할 수 없습니다." }, { status: 400 });
  }
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  savePackagingSoNo(getDb(), planDate, lineKey, body.soNo ?? "", session?.u ?? null);
  return NextResponse.json({ ok: true });
}
