import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { insertManualNcr, listBlisterLots, listNcr, listSupplyLots } from "@/lib/qc-incoming";

export const runtime = "nodejs";

// 수입검사(QC-03) 부적합 탭 — 부적합 대장을 만드는 데 필요한 것을 한 번에 내려 준다:
// 부자재 로트 + 블리스터 로트(입력원) + 처리 기록(qc_ncr). 대상 판정(부적합률 10% 이상 등)은 화면이 대시보드와 같은 규칙으로 계산한다.
export async function GET() {
  const db = getDb();
  return NextResponse.json({ lots: listSupplyLots(db), blister: listBlisterLots(db), records: listNcr(db) });
}

// 부적합 로트 직접 추가
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  if (!String(body.lot ?? "").trim()) return NextResponse.json({ error: "Lot No.를 입력해 주세요." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date ?? ""))) return NextResponse.json({ error: "일자를 입력해 주세요." }, { status: 400 });
  const bad = Number(body.bad);
  if (!Number.isFinite(bad) || bad < 0) return NextResponse.json({ error: "부적합수량을 입력해 주세요." }, { status: 400 });
  const user = verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
  const k = insertManualNcr(getDb(), body, user);
  return NextResponse.json({ ok: true, k }, { status: 201 });
}
