import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { STOCK_TX_TYPES } from "@/lib/stock-ledger-shared";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function warehouseOptions(db: ReturnType<typeof getDb>): string[] {
  const rows = db
    .prepare(
      `SELECT warehouse AS w FROM stock_ledger
       UNION SELECT warehouse FROM inventory_status
       UNION SELECT warehouse_name FROM warehouses
       ORDER BY 1`
    )
    .all() as { w: string | null }[];
  return rows.map((r) => r.w).filter((w): w is string => !!w);
}

// GET ?view=ledger(기본, 수불 내역) | stock(품목×LOT×창고별 수불 합계 = MES 현재고)
export async function GET(req: NextRequest) {
  const db = getDb();
  const p = req.nextUrl.searchParams;
  const view = p.get("view") === "stock" ? "stock" : "ledger";
  const page = Math.max(1, parseInt(p.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(p.get("pageSize") ?? "50", 10) || 50));
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const args: (string | number)[] = [];
  const dateFrom = p.get("dateFrom");
  const dateTo = p.get("dateTo");
  if (view === "ledger" && dateFrom && DATE_RE.test(dateFrom)) {
    where.push("substr(l.tx_at, 1, 10) >= ?");
    args.push(dateFrom);
  }
  if (view === "ledger" && dateTo && DATE_RE.test(dateTo)) {
    where.push("substr(l.tx_at, 1, 10) <= ?");
    args.push(dateTo);
  }
  const txType = p.get("txType");
  if (view === "ledger" && txType) {
    where.push("l.tx_type = ?");
    args.push(txType);
  }
  const reason = p.get("reason");
  if (view === "ledger" && reason) {
    where.push("l.reason = ?");
    args.push(reason);
  }
  const warehouse = p.get("warehouse");
  if (warehouse) {
    where.push("l.warehouse = ?");
    args.push(warehouse);
  }
  const search = (p.get("search") ?? "").trim();
  if (search) {
    where.push("(l.item_code LIKE ? OR l.lot_no LIKE ? OR l.ref_no LIKE ? OR i.item_name LIKE ?)");
    const like = `%${search}%`;
    args.push(like, like, like, like);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  if (view === "ledger") {
    const join = "FROM stock_ledger l LEFT JOIN items i ON i.item_code = l.item_code";
    const total = (db.prepare(`SELECT COUNT(*) AS c ${join} ${whereSql}`).get(...args) as { c: number }).c;
    const sums = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN l.qty > 0 THEN l.qty END), 0) AS plus,
                COALESCE(SUM(CASE WHEN l.qty < 0 THEN l.qty END), 0) AS minus ${join} ${whereSql}`
      )
      .get(...args) as { plus: number; minus: number };
    const rows = db
      .prepare(
        `SELECT l.id, l.tx_at, l.item_code, i.item_name, l.lot_no, l.warehouse, l.tx_type, l.qty,
                l.reason, l.ref_no, l.memo, l.created_by
         ${join} ${whereSql} ORDER BY l.tx_at DESC, l.id DESC LIMIT ? OFFSET ?`
      )
      .all(...args, pageSize, offset);
    return NextResponse.json({ rows, total, page, pageSize, sums, warehouses: warehouseOptions(db) });
  }

  const base = `FROM (SELECT l.item_code, l.lot_no, l.warehouse, ROUND(SUM(l.qty), 3) AS qty
       FROM stock_ledger l LEFT JOIN items i ON i.item_code = l.item_code ${whereSql}
       GROUP BY l.item_code, l.lot_no, l.warehouse
       ${p.get("includeZero") === "1" ? "" : "HAVING ABS(SUM(l.qty)) > 0.0005"}) s
     LEFT JOIN items i ON i.item_code = s.item_code`;
  const total = (db.prepare(`SELECT COUNT(*) AS c ${base}`).get(...args) as { c: number }).c;
  const sum = (db.prepare(`SELECT COALESCE(SUM(s.qty), 0) AS t ${base}`).get(...args) as { t: number }).t;
  const rows = db
    .prepare(
      `SELECT s.item_code, i.item_name, s.lot_no, s.warehouse, s.qty ${base}
       ORDER BY s.item_code, s.lot_no, s.warehouse LIMIT ? OFFSET ?`
    )
    .all(...args, pageSize, offset);
  return NextResponse.json({ rows, total, page, pageSize, sum, warehouses: warehouseOptions(db) });
}

// POST — 수동 등록(생산투입·생산입고·조정 등). 입고/출고/이동은 양수 수량을 받아 서버가 부호를 정하고,
// 이동은 출발(−)/도착(+) 두 행을 같은 참조번호로 한 번에 쌓는다. 조정만 ±를 그대로 받는다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const itemCode = String(body.item_code ?? "").trim();
  const lotNo = String(body.lot_no ?? "").trim();
  const warehouse = String(body.warehouse ?? "").trim();
  const toWarehouse = String(body.to_warehouse ?? "").trim();
  const txType = String(body.tx_type ?? "");
  const reason = String(body.reason ?? "").trim();
  const refNo = String(body.ref_no ?? "").trim() || null;
  const memo = String(body.memo ?? "").trim() || null;
  const qty = Number(body.qty);
  const txDate = String(body.tx_date ?? "");

  if (!itemCode) return NextResponse.json({ error: "품목코드를 입력하세요." }, { status: 400 });
  if (!warehouse) return NextResponse.json({ error: "창고를 선택하세요." }, { status: 400 });
  if (!(STOCK_TX_TYPES as readonly string[]).includes(txType))
    return NextResponse.json({ error: "구분이 올바르지 않습니다." }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "근거를 입력하세요." }, { status: 400 });
  if (!Number.isFinite(qty) || qty === 0)
    return NextResponse.json({ error: "수량을 0이 아닌 숫자로 입력하세요." }, { status: 400 });
  if (txType !== "조정" && qty < 0)
    return NextResponse.json({ error: "입고/출고/이동 수량은 양수로 입력하세요(부호는 구분에 따라 자동 적용)." }, { status: 400 });
  if (!DATE_RE.test(txDate)) return NextResponse.json({ error: "일자를 입력하세요." }, { status: 400 });
  if (txType === "이동") {
    if (!toWarehouse) return NextResponse.json({ error: "도착 창고를 선택하세요." }, { status: 400 });
    if (toWarehouse === warehouse)
      return NextResponse.json({ error: "출발 창고와 도착 창고가 같습니다." }, { status: 400 });
  }

  const db = getDb();
  if (!db.prepare("SELECT 1 FROM items WHERE item_code = ?").get(itemCode)) {
    return NextResponse.json({ error: `품목코드 ${itemCode} 가 품목정보에 없습니다.` }, { status: 400 });
  }
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const user = session?.n || session?.u || "unknown";
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const txAt = `${txDate} ${hh}:${mm}:${ss}`;
  const q = Math.round(qty * 1000) / 1000;

  const ins = db.prepare(
    `INSERT INTO stock_ledger (tx_at, item_code, lot_no, warehouse, tx_type, qty, reason, ref_no, memo, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.exec("BEGIN");
  try {
    if (txType === "이동") {
      ins.run(txAt, itemCode, lotNo, warehouse, txType, -q, reason, refNo, memo, user);
      ins.run(txAt, itemCode, lotNo, toWarehouse, txType, q, reason, refNo, memo, user);
    } else {
      const signed = txType === "출고" ? -q : q;
      ins.run(txAt, itemCode, lotNo, warehouse, txType, signed, reason, refNo, memo, user);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
