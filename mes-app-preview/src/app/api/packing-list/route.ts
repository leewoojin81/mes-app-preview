import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { createPackingList, getPackingList, listOrders, savePackingList, setPackingStatus, type PackingSave } from "@/lib/packing-list";

export const runtime = "nodejs";

// 영업관리 Packing List(SALES-04) — 규칙은 lib/packing-list.ts
//  GET   /api/packing-list?q=검색어      → 수주 목록(진행 중 + Packing List 있는 수주)
//  GET   /api/packing-list?pl=PL...     → Packing List 상세
//  POST  /api/packing-list { so_no, form } → 새로 만들기(라벨일정·품목정보 기본값으로 박스 자동 나누기)
//  PUT   /api/packing-list { pl_no, ...PackingSave } → 저장(rebuild=true면 박스 다시 나누기)
//  PATCH /api/packing-list { pl_no, action: confirm|reopen|cancel } → 확정 / 확정 풀기 / 취소
const userOf = (req: NextRequest) => verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
const fail = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : "처리하지 못했습니다." }, { status: 400 });

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const db = getDb();
  const pl = sp.get("pl");
  if (pl) {
    const r = getPackingList(db, pl.trim());
    return r ? NextResponse.json(r) : NextResponse.json({ error: "Packing List가 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ orders: listOrders(db, sp.get("q") ?? "") });
}

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { so_no?: string; form?: string } | null;
  if (!b?.so_no) return NextResponse.json({ error: "수주번호가 필요합니다." }, { status: 400 });
  try {
    const plNo = createPackingList(getDb(), b.so_no.trim(), b.form === "cn" ? "cn" : "std", userOf(req));
    return NextResponse.json({ pl_no: plNo }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as (PackingSave & { pl_no?: string }) | null;
  if (!b?.pl_no) return NextResponse.json({ error: "Packing List 번호가 필요합니다." }, { status: 400 });
  const db = getDb();
  try {
    savePackingList(db, b.pl_no, b, userOf(req));
    return NextResponse.json(getPackingList(db, b.pl_no));
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { pl_no?: string; action?: string } | null;
  if (!b?.pl_no || (b.action !== "confirm" && b.action !== "reopen" && b.action !== "cancel")) {
    return NextResponse.json({ error: "Packing List 번호와 처리 종류가 필요합니다." }, { status: 400 });
  }
  const db = getDb();
  try {
    setPackingStatus(db, b.pl_no, b.action, userOf(req));
    return NextResponse.json(getPackingList(db, b.pl_no));
  } catch (e) {
    return fail(e);
  }
}
