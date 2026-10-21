import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { resetSupplyLot } from "@/lib/qc-incoming";

export const runtime = "nodejs";

// 수정한 로트를 엑셀 원본 값으로 되돌린다
export async function POST(req: NextRequest, { params }: { params: Promise<{ no: string }> }) {
  const no = Number((await params).no);
  if (!Number.isInteger(no)) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  const user = verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
  const lot = resetSupplyLot(getDb(), no, user);
  if (!lot) return NextResponse.json({ error: "엑셀 원본이 없는 로트입니다." }, { status: 400 });
  return NextResponse.json({ ok: true, lot });
}
