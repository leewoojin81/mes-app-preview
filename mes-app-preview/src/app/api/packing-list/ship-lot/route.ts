import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import {
  cancelShipLot,
  deleteDateRule,
  getShipLotSo,
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
//  GET    (조건 없음)              → 그리드(PLAN-04 수주 줄 + 수주별 출하LOT)
//  GET    ?so=SO...                → 그 수주의 대표품목·기본값(2026-10-26부터 MO가 아니라 수주 기준)
//  GET    ?prefix=6A               → 그 달에 쓴 출하LOT과 다음 차수
//  GET    ?rules=1                 → 생산일자 표기 규칙 + 고를 거리(국가·형명)
//  POST   { so_no, lot_no, prod_date, country, sales_manager, fmts } → 발행(다시 발행)
//  POST   { bulk: { so_nos, prod_date, mode: same|each, lot_no?, reissue?, per? } } → 여러 수주 한 번에 발행
//  DELETE ?so=SO...                → 발행 취소
//  PUT    { country, model_name, date_fmt } → 표기 규칙 저장
//  DELETE ?rule_country=&rule_model= → 표기 규칙 삭제
const userOf = (req: NextRequest) => verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
const fail = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : "처리하지 못했습니다." }, { status: 400 });

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const db = getDb();
  const so = sp.get("so");
  if (so) {
    const r = getShipLotSo(db, so.trim());
    return r ? NextResponse.json(r) : NextResponse.json({ error: "이 수주번호가 없습니다." }, { status: 404 });
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
        { so_nos: Array.isArray(k.so_nos) ? k.so_nos.map(String) : [], prod_date: String(k.prod_date ?? ""), mode: k.mode === "each" ? "each" : "same", lot_no: k.lot_no, reissue: !!k.reissue, per: k.per && typeof k.per === "object" ? k.per : undefined },
        userOf(req)
      );
      return NextResponse.json({ results });
    } catch (e) {
      return fail(e);
    }
  }
  if (!b?.so_no || !b.lot_no || !b.prod_date) return NextResponse.json({ error: "수주번호·출하LOT·생산일자가 필요합니다." }, { status: 400 });
  const db = getDb();
  try {
    issueShipLot(
      db,
      { so_no: b.so_no, lot_no: b.lot_no, prod_date: b.prod_date, country: b.country ?? "", sales_manager: b.sales_manager ?? "", fmts: b.fmts },
      userOf(req)
    );
    return NextResponse.json(getShipLotSo(db, b.so_no));
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
  const so = sp.get("so")?.trim();
  if (!so) return NextResponse.json({ error: "수주번호가 필요합니다." }, { status: 400 });
  cancelShipLot(db, so);
  return NextResponse.json({ ok: true });
}
