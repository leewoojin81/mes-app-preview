import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { cleanLotInput, insertSupplyLot, listSupplyLots } from "@/lib/qc-incoming";

export const runtime = "nodejs";

// 입고검사 관리대장(QC-03) 부자재 탭 — 로트 목록 / 로트 추가
export async function GET() {
  return NextResponse.json({ lots: listSupplyLots(getDb()) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  const input = cleanLotInput(body);
  if (!input.lot_no) return NextResponse.json({ error: "Lot No.를 입력해 주세요." }, { status: 400 });
  if (!input.recv_date) return NextResponse.json({ error: "입고일자를 입력해 주세요." }, { status: 400 });
  if (!input.name) return NextResponse.json({ error: "품명을 입력해 주세요." }, { status: 400 });
  const user = verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
  const lot = insertSupplyLot(getDb(), input, user);
  return NextResponse.json({ ok: true, lot }, { status: 201 });
}
