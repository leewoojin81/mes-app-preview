import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { getOrderForm, listOrderFormMos, saveOrderForm } from "@/lib/label-order-form";

export const runtime = "nodejs";

// 마킹출하공정(PROC-06) 오더양식 — ?mo= 한 장 / 없으면 ANW MO 목록(?q= 검색). POST { mo_no, input } 저장
export async function GET(req: NextRequest) {
  const mo = req.nextUrl.searchParams.get("mo")?.trim() ?? "";
  const db = getDb();
  if (!mo) return NextResponse.json({ mos: listOrderFormMos(db, req.nextUrl.searchParams.get("q") ?? "") });
  const form = getOrderForm(db, mo);
  if (!form) return NextResponse.json({ error: "그 MO번호의 수주가 없습니다." }, { status: 404 });
  return NextResponse.json(form);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { mo_no?: unknown; input?: unknown } | null;
  const mo = typeof body?.mo_no === "string" ? body.mo_no.trim() : "";
  if (!mo) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  const user = verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
  saveOrderForm(getDb(), mo, body?.input, user);
  return NextResponse.json({ ok: true });
}
