import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { STOCK_CHECK_WAREHOUSES } from "@/lib/stock-check";
import type { StockCheckRow } from "@/lib/types";

export const runtime = "nodejs";

// 완제품코드에서 도수를 뗀 대표코드로 BOM 1단계(직접 구성품) 중 반제품이면서
// 품목군이 "착색"인 것만 조회해(몰드 등 다른 반제품군은 재고확인 대상이 아니다)
// 계획수량 기준 소요량을 계산하고, 현재고현황(INV-02) LOT별 재고와 비교한다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const repItemCode = req.nextUrl.searchParams.get("itemCode")?.trim();
  const planQty = Number(req.nextUrl.searchParams.get("planQty") ?? "");

  if (!repItemCode || !Number.isFinite(planQty) || planQty <= 0) {
    return NextResponse.json({ error: "품목코드와 계획수량이 필요합니다." }, { status: 400 });
  }

  const bomRows = db
    .prepare(
      `SELECT b.child_item_code, it.unit, b.qty_per
       FROM bom b
       JOIN items it ON it.item_code = b.child_item_code
       WHERE b.parent_item_code = ?
         AND it.category = '반제품'
         AND json_extract(it.detail, '$."품목군"') = '착색'
       ORDER BY b.child_item_code`
    )
    .all(repItemCode) as { child_item_code: string; unit: string; qty_per: number }[];

  const lotsByCode = new Map<
    string,
    { id: number; lot_no: string; warehouse: string | null; qty: number; division: string }[]
  >();
  if (bomRows.length > 0) {
    const codes = bomRows.map((r) => r.child_item_code);
    const lotRows = db
      .prepare(
        `SELECT id, item_code, lot_no, warehouse, stock_qty
         FROM inventory_status
         WHERE item_code IN (${codes.map(() => "?").join(",")})
           AND warehouse IN (${STOCK_CHECK_WAREHOUSES.map(() => "?").join(",")})
         ORDER BY item_code, warehouse, lot_no`
      )
      .all(...codes, ...STOCK_CHECK_WAREHOUSES) as {
      id: number;
      item_code: string;
      lot_no: string | null;
      warehouse: string | null;
      stock_qty: number | null;
    }[];

    // 구분 "자동" 판정 — 일일작업현황(PROD-10)에서 같은 LOT No가 아래 공정코드로 실적이
    // 잡힌 설비(라인)명이 설비등록(BASE-05)에서 해당 접두어로 시작하는 설비면 자동이다.
    // P210(Base 인쇄) → "자동Base", P220(착색 인쇄) → "자동인쇄". 둘 중 하나라도 해당하면 자동.
    const AUTO_RULES = [
      { processCode: "P210", equipmentPrefix: "자동Base" },
      { processCode: "P220", equipmentPrefix: "자동인쇄" },
    ] as const;
    const lotNos = [...new Set(lotRows.map((r) => r.lot_no).filter((v): v is string => !!v))];
    const autoLotNos = new Set<string>();
    if (lotNos.length > 0) {
      for (const rule of AUTO_RULES) {
        const autoEquipNames = new Set(
          (
            db
              .prepare("SELECT equipment_name FROM equipments WHERE equipment_name LIKE ?")
              .all(`${rule.equipmentPrefix}%`) as { equipment_name: string }[]
          ).map((r) => r.equipment_name)
        );
        if (autoEquipNames.size === 0) continue;
        const lineRows = db
          .prepare(
            `SELECT DISTINCT lot_no, json_extract(detail, '$."라인"') as line
             FROM daily_work_status
             WHERE process_code = ? AND lot_no IN (${lotNos.map(() => "?").join(",")})`
          )
          .all(rule.processCode, ...lotNos) as { lot_no: string; line: string | null }[];
        for (const r of lineRows) {
          if (r.line && autoEquipNames.has(r.line)) autoLotNos.add(r.lot_no);
        }
      }
    }

    for (const r of lotRows) {
      const list = lotsByCode.get(r.item_code) ?? [];
      list.push({
        id: r.id,
        lot_no: r.lot_no ?? "-",
        warehouse: r.warehouse,
        qty: r.stock_qty ?? 0,
        division: r.lot_no && autoLotNos.has(r.lot_no) ? "자동" : "-",
      });
      lotsByCode.set(r.item_code, list);
    }
  }

  const rows: StockCheckRow[] = bomRows.map((b) => {
    const required_qty = planQty * b.qty_per;
    const lots = lotsByCode.get(b.child_item_code) ?? [];
    const stock_qty = lots.reduce((sum, l) => sum + l.qty, 0);
    const shortage_qty = Math.max(0, required_qty - stock_qty);
    return {
      child_item_code: b.child_item_code,
      unit: b.unit,
      qty_per: b.qty_per,
      required_qty,
      stock_qty,
      shortage_qty,
      sufficient: shortage_qty <= 0,
      lots,
    };
  });

  return NextResponse.json({ parent_item_code: repItemCode, planQty, rows });
}
