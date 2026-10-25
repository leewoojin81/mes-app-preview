import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { clearAssyMark, fetchAssemblyRecords, fetchColorStock, fetchDueOrderLines, fetchDueOrders, fetchItemChange, setAssyMark } from "@/lib/due-orders";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import {
  applyMaterialTemps,
  deleteMaterialTemp,
  fetchMaterialSupply,
  MATERIAL_KINDS,
  saveMaterialTemp,
  summarizeByOrder,
  type MaterialKind,
} from "@/lib/material-supply";

export const runtime = "nodejs";

// 생산계획 납기별수주현황(PLAN-04)
//  GET /api/due-orders            → 진행 중인 수주 목록(순위·주문량·공정재공·조립투입·출하부족)
//  GET /api/due-orders?so=SO...   → 그 수주의 품목·도수별 상세
//  GET /api/due-orders?fresh=1    → 30초 캐시를 무시하고 다시 계산
//  GET /api/due-orders?dosu=품목코드&near=위,아래 → 그 품목·위아래 도수로 최근 1개월(조립일자) 조립된 작업지시 기록
//                                     + 그 품목에서 다른 도수로 변경된 작업지시(도수변경 건 표시)
//  GET /api/due-orders?color=모델   → 그 모델의 착색 현재고(조립창고, LOT별 무도수용/유도수용)
//  GET /api/due-orders?swap=품목코드 → 그 도수로 품목변경할 수 있는 다른 도수 재공(외관검사 측정값 ±0.225)
//  GET /api/due-orders?materials=1 → 수주별 자재일정(실링지·단상자·라벨·설명서) — 자재수급(PUR-03) 계산을 그대로 쓴다.
//                                     PUR-03 권한이 없는 PLAN-04 사용자도 보도록 /api/material-supply 대신 여기서 준다
//                                     (임시 자재일정 입력값을 덮어씀)
//  PUT    /api/due-orders { so_no, kind, status: order|po, eta?, note? } → 자재일정 임시값 저장(새 발주가 올라오면 자동 해제)
//  DELETE /api/due-orders?so=SO...&kind=seal → 자재일정 임시값 해제
//  PUT    /api/due-orders { assy: true, so_no, item_code, qty } → 도수별 상세 조립투입 "투입함" 표시(모든 사용자 공유)
//  DELETE /api/due-orders?so=SO...&item=품목코드 → 조립투입 표시 해제
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const so = sp.get("so");
  const db = getDb();
  const dosu = sp.get("dosu");
  if (dosu) {
    const near = (sp.get("near") ?? "").split(",").map((c) => c.trim()).filter(Boolean).slice(0, 4);
    return NextResponse.json(fetchAssemblyRecords(db, dosu.trim(), near));
  }
  const color = sp.get("color");
  if (color) return NextResponse.json(fetchColorStock(db, color.trim()));
  if (sp.get("materials") === "1") {
    const ms = fetchMaterialSupply(db);
    return NextResponse.json({ as_of: ms.as_of, orders: applyMaterialTemps(db, summarizeByOrder(ms.rows)) });
  }
  const swap = sp.get("swap");
  if (swap) return NextResponse.json(fetchItemChange(db, swap.trim()));
  if (so) return NextResponse.json(fetchDueOrderLines(db, so.trim()));
  return NextResponse.json(fetchDueOrders(db, sp.get("fresh") === "1"));
}

const isKind = (k: unknown): k is MaterialKind => MATERIAL_KINDS.some((m) => m.key === k);

export async function PUT(request: NextRequest) {
  const b = (await request.json().catch(() => null)) as
    | { so_no?: unknown; kind?: unknown; status?: unknown; eta?: unknown; note?: unknown; assy?: unknown; item_code?: unknown; qty?: unknown }
    | null;
  const so_no = typeof b?.so_no === "string" ? b.so_no.trim() : "";
  if (b?.assy === true) {
    const item = typeof b.item_code === "string" ? b.item_code.trim() : "";
    if (!so_no || !item) return NextResponse.json({ error: "수주번호·품목코드가 필요합니다." }, { status: 400 });
    const user = verifySession(request.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
    setAssyMark(getDb(), so_no, item, typeof b.qty === "number" && Number.isFinite(b.qty) ? b.qty : 0, user);
    return NextResponse.json({ ok: true });
  }
  if (!so_no || !isKind(b?.kind) || (b?.status !== "order" && b?.status !== "po")) {
    return NextResponse.json({ error: "수주번호·자재·상태가 필요합니다." }, { status: 400 });
  }
  const db = getDb();
  const user = verifySession(request.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
  try {
    saveMaterialTemp(db, fetchMaterialSupply(db).rows, {
      so_no,
      kind: b.kind,
      status: b.status,
      eta: typeof b.eta === "string" ? b.eta : null,
      note: typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 100) : null,
      user,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "저장하지 못했습니다." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const sp = new URL(request.url).searchParams;
  const so = sp.get("so")?.trim();
  const item = sp.get("item")?.trim();
  if (so && item) {
    clearAssyMark(getDb(), so, item);
    return NextResponse.json({ ok: true });
  }
  const kind = sp.get("kind");
  if (!so || !isKind(kind)) return NextResponse.json({ error: "수주번호·자재가 필요합니다." }, { status: 400 });
  deleteMaterialTemp(getDb(), so, kind);
  return NextResponse.json({ ok: true });
}
