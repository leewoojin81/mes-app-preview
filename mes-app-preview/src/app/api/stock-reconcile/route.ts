import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBaseline, reconcileSql } from "@/lib/stock-ledger";

export const runtime = "nodejs";

// GET — ERP 스냅샷(INV-02)과 MES 수불 합계를 품목×LOT×창고 기준으로 비교.
// diffOnly=1 이면 일치 행을 제외(불일치만 보기). summary는 diffOnly/kind와 무관하게 창고·검색 필터까지만 적용.
export async function GET(req: NextRequest) {
  const db = getDb();
  const p = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(p.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(p.get("pageSize") ?? "50", 10) || 50));
  const asOf = p.get("asOf") ?? "";
  const { cte, args, listWhere } = reconcileSql({
    warehouse: p.get("warehouse") ?? "",
    search: (p.get("search") ?? "").trim(),
    asOf: /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : "",
    kind: p.get("kind") ?? "",
    diffOnly: p.get("diffOnly") === "1",
  });

  const summary = db
    .prepare(
      `${cte}
       SELECT COUNT(*) AS keys,
              COALESCE(SUM(kind = 'match'), 0) AS match, COALESCE(SUM(kind = 'diff'), 0) AS diff,
              COALESCE(SUM(kind = 'erp_only'), 0) AS erp_only, COALESCE(SUM(kind = 'mes_only'), 0) AS mes_only,
              COALESCE(SUM(erp_qty), 0) AS erp_total, COALESCE(SUM(mes_qty), 0) AS mes_total
       FROM joined`
    )
    .get(...args);
  const total = (
    db.prepare(`${cte} SELECT COUNT(*) AS c FROM joined ${listWhere}`).get(...args) as { c: number }
  ).c;
  const rows = db
    .prepare(
      `${cte}
       SELECT * FROM joined ${listWhere}
       ORDER BY ABS(diff) DESC, item_code, lot_no, warehouse LIMIT ? OFFSET ?`
    )
    .all(...args, pageSize, (page - 1) * pageSize);

  const warehouses = (
    db
      .prepare(
        "SELECT warehouse AS w FROM inventory_status UNION SELECT warehouse FROM stock_ledger ORDER BY 1"
      )
      .all() as { w: string | null }[]
  )
    .map((r) => r.w)
    .filter((w): w is string => !!w);
  const snapshotAt = (db.prepare("SELECT MAX(uploaded_at) AS t FROM inventory_status").get() as { t: string | null }).t;

  return NextResponse.json({
    rows,
    total,
    page,
    pageSize,
    summary,
    warehouses,
    snapshotAt,
    baseline: getBaseline(db),
  });
}
