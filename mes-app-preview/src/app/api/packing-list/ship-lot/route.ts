import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import {
  cancelShipLot,
  deleteDateRule,
  getShipLotMo,
  issueShipLot,
  issueShipLots,
  listDateRules,
  monthLots,
  ruleChoices,
  setDateRule,
  shipLotGrid,
  type DateFmt,
  type ShipLotBulkIssue,
  type ShipLotIssue,
} from "@/lib/ship-lot";

export const runtime = "nodejs";

// Packing List(SALES-04) 출하LOT 탭 — 규칙은 lib/ship-lot.ts
//  GET    (조건 없음)              → 그리드(PLAN-04 수주 줄 + MO별 출하LOT)
//  GET    ?mo=MO...                → 그 MO의 대표품목·기본값
//  GET    ?prefix=6A               → 그 달에 쓴 출하LOT과 다음 차수
//  GET    ?rules=1                 → 생산일자 표기 규칙 + 고를 거리(국가·형명)
//  POST   { mo_no, lot_no, prod_date, country, sales_manager, fmts } → 발행(다시 발행)
//  POST   { bulk: { mo_nos, prod_date, mode: same|each, lot_no?, reissue? } } → 여러 MO 일괄 발행
//  DELETE ?mo=MO...                → 발행 취소
//  PUT    { country, model_name, date_fmt } → 표기 규칙 저장
//  DELETE ?rule_country=&rule_model= → 표기 규칙 삭제
const userOf = (req: NextRequest) => verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
const fail = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : "처리하지 못했습니다." }, { status: 400 });

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const db = getDb();
  const mo = sp.get("mo");
  if (mo) {
    const r = getShipLotMo(db, mo.trim());
    return r ? NextResponse.json(r) : NextResponse.json({ error: "수주에 이 MO가 없습니다." }, { status: 404 });
  }
  const prefix = sp.get("prefix");
  if (prefix != null) return NextResponse.json(monthLots(db, prefix.trim()));
  if (sp.get("rules") === "1") return NextResponse.json({ rules: listDateRules(db), ...ruleChoices(db) });
  return NextResponse.json({ rows: shipLotGrid(db) });
}

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as (Partial<ShipLotIssue> & { bulk?: ShipLotBulkIssue }) | null;
  if (b?.bulk) {
    const k = b.bulk;
    try {
      const results = issueShipLots(
        getDb(),
        { mo_nos: Array.isArray(k.mo_nos) ? k.mo_nos.map(String) : [], prod_date: String(k.prod_date ?? ""), mode: k.mode === "each" ? "each" : "same", lot_no: k.lot_no, reissue: !!k.reissue },
        userOf(req)
      );
      return NextResponse.json({ results });
    } catch (e) {
      return fail(e);
    }
  }
  if (!b?.mo_no || !b.lot_no || !b.prod_date) return NextResponse.json({ error: "MO·출하LOT·생산일자가 필요합니다." }, { status: 400 });
  const db = getDb();
  try {
    issueShipLot(
      db,
      { mo_no: b.mo_no, lot_no: b.lot_no, prod_date: b.prod_date, country: b.country ?? "", sales_manager: b.sales_manager ?? "", fmts: b.fmts },
      userOf(req)
    );
    return NextResponse.json(getShipLotMo(db, b.mo_no));
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { country?: string; model_name?: string; date_fmt?: DateFmt } | null;
  try {
    setDateRule(getDb(), { country: b?.country ?? "", model_name: b?.model_name ?? "", date_fmt: b?.date_fmt as DateFmt }, userOf(req));
    return NextResponse.json({ rules: listDateRules(getDb()) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const db = getDb();
  const rc = sp.get("rule_country");
  if (rc != null) {
    deleteDateRule(db, rc, sp.get("rule_model") ?? "");
    return NextResponse.json({ rules: listDateRules(db) });
  }
  const mo = sp.get("mo")?.trim();
  if (!mo) return NextResponse.json({ error: "MO가 필요합니다." }, { status: 400 });
  cancelShipLot(db, mo);
  return NextResponse.json({ ok: true });
}
