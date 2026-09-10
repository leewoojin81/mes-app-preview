import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull } from "@/lib/item-fields";

export const runtime = "nodejs";

// 계획정보(PLAN-02) — 선택한 품목 기준으로 사용 중인 공정(use_yn='Y') 전체를 순서대로
// 내려주고, 그중 이 품목에 개별 입력된 값(daily_capa/yield_rate/lot_size)이 있으면 함께
// 붙인다. 개별 값이 없는 필드는 화면에서 default_* 로 대체 표시(fallback)한다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const itemCode = req.nextUrl.searchParams.get("item_code");
  if (!itemCode) {
    return NextResponse.json({ error: "item_code가 필요합니다." }, { status: 400 });
  }

  const rows = db
    .prepare(
      `SELECT p.process_code, p.process_name, p.seq,
              p.default_daily_capa, p.default_yield_rate, p.default_lot_size,
              r.daily_capa, r.yield_rate, r.lot_size
       FROM processes p
       LEFT JOIN item_process_routing r
         ON r.process_code = p.process_code AND r.item_code = ?
       WHERE p.use_yn = 'Y'
       ORDER BY p.seq, p.process_code`
    )
    .all(itemCode);

  return NextResponse.json(rows);
}

interface RoutingBody {
  item_code?: string;
  process_code?: string;
  daily_capa?: number | string | null;
  yield_rate?: number | string | null;
  lot_size?: number | string | null;
}

// 품목×공정 한 칸(행)의 개별값 저장 — 세 값이 모두 비면 오버라이드 자체가 의미 없으므로
// 행을 지워서 완전히 공정 기본값을 따르게 한다.
export async function PATCH(req: NextRequest) {
  const db = getDb();
  const body = (await req.json().catch(() => null)) as RoutingBody | null;
  const itemCode = body?.item_code?.trim();
  const processCode = body?.process_code?.trim();
  if (!itemCode || !processCode) {
    return NextResponse.json(
      { error: "item_code, process_code가 필요합니다." },
      { status: 400 }
    );
  }
  if (!db.prepare("SELECT 1 FROM items WHERE item_code = ?").get(itemCode)) {
    return NextResponse.json({ error: "존재하지 않는 품목입니다." }, { status: 400 });
  }
  if (!db.prepare("SELECT 1 FROM processes WHERE process_code = ?").get(processCode)) {
    return NextResponse.json({ error: "존재하지 않는 공정입니다." }, { status: 400 });
  }

  const dailyCapa = numOrNull(body?.daily_capa);
  const yieldRate = numOrNull(body?.yield_rate);
  const lotSize = numOrNull(body?.lot_size);
  if (dailyCapa === undefined || yieldRate === undefined || lotSize === undefined) {
    return NextResponse.json(
      { error: "일CAPA/생산수율/Lot Size는 숫자여야 합니다." },
      { status: 400 }
    );
  }

  if (dailyCapa === null && yieldRate === null && lotSize === null) {
    db.prepare(
      "DELETE FROM item_process_routing WHERE item_code = ? AND process_code = ?"
    ).run(itemCode, processCode);
    return NextResponse.json({ ok: true, cleared: true });
  }

  db.prepare(
    `INSERT INTO item_process_routing (item_code, process_code, daily_capa, yield_rate, lot_size, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(item_code, process_code) DO UPDATE SET
       daily_capa = excluded.daily_capa,
       yield_rate = excluded.yield_rate,
       lot_size = excluded.lot_size,
       updated_at = excluded.updated_at`
  ).run(itemCode, processCode, dailyCapa, yieldRate, lotSize);

  return NextResponse.json({ ok: true, cleared: false });
}
