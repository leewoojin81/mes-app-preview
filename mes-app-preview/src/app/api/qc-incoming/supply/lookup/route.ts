import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureQcIncomingTables } from "@/lib/qc-incoming";

export const runtime = "nodejs";

const QTY_DEFAULT: Record<string, number> = { 실링지: 1512, 단상자: 125, 라벨: 5, 설명서: 5 };
const PREFIX_PART: Record<string, string> = { BIP: "단상자", BFS: "실링지", BIL: "라벨", BII: "설명서" };

function partGuess(name: string): string {
  return /실링지/.test(name) ? "실링지" : /설명서/.test(name) ? "설명서" : /라벨/.test(name) ? "라벨" : /단상자/.test(name) ? "단상자" : "기타";
}

// 로트 추가 창의 자동 입력 — 대시보드의 자재코드 자동 채움/Lot 번호 제안과 같은 동작
//   ?code=자재코드 → 같은 자재코드의 직전 로트(없으면 BOM/품목 마스터)에서 자재·품명·납품업체·품목코드·수량을 알려 준다
//   ?recv=YYYY-MM-DD → 그날 입고분의 다음 Lot 번호(YYYYMMDD-NN) 제안
export async function GET(req: NextRequest) {
  const db = getDb();
  ensureQcIncomingTables(db);
  const sp = req.nextUrl.searchParams;
  const recv = sp.get("recv");
  if (recv) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(recv)) return NextResponse.json({ lot: "" });
    const pre = recv.replace(/-/g, "");
    const rows = db.prepare("SELECT lot_no FROM qc_supply_lots WHERE lot_no LIKE ?").all(`${pre}-%`) as { lot_no: string }[];
    let mx = 0;
    for (const r of rows) {
      const k = Number(r.lot_no.slice(9));
      if (Number.isFinite(k) && k > mx) mx = k;
    }
    return NextResponse.json({ lot: `${pre}-${mx + 1 < 10 ? "0" : ""}${mx + 1}` });
  }
  const code = (sp.get("code") ?? "").trim().toUpperCase();
  if (!code) return NextResponse.json({ found: false });
  const items = (
    db.prepare("SELECT DISTINCT parent_item_code p FROM bom WHERE child_item_code = ? ORDER BY parent_item_code LIMIT 30").all(code) as { p: string }[]
  ).map((r) => r.p);
  const last = db
    .prepare("SELECT no, part, name, supplier, item_code, lot_qty, insp_qty FROM qc_supply_lots WHERE mat_code = ? ORDER BY no DESC LIMIT 1")
    .get(code) as { no: number; part: string; name: string; supplier: string; item_code: string; lot_qty: number; insp_qty: number } | undefined;
  if (last) {
    return NextResponse.json({
      found: true,
      source: "lot",
      last_no: last.no,
      part: last.part,
      name: last.name,
      supplier: last.supplier,
      item: last.item_code || items[0] || "",
      lot_qty: last.lot_qty,
      insp_qty: last.insp_qty,
      items,
    });
  }
  if (items.length > 0) {
    const nm = (db.prepare("SELECT item_name n FROM items WHERE item_code = ?").get(items[0]) as { n: string } | undefined)?.n ?? "";
    const part = PREFIX_PART[code.slice(0, 3)] ?? partGuess(nm);
    return NextResponse.json({
      found: true,
      source: "bom",
      part,
      name: nm ? `${nm} (${items[0]})` : "",
      supplier: "",
      item: items[0],
      lot_qty: 0,
      insp_qty: QTY_DEFAULT[part] ?? 0,
      items,
    });
  }
  const part = PREFIX_PART[code.slice(0, 3)] ?? "";
  return NextResponse.json({ found: false, part, insp_qty: QTY_DEFAULT[part] ?? 0 });
}
