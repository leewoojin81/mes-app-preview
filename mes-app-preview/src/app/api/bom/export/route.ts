import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as XLSX from "xlsx";
import type { DatabaseSync } from "node:sqlite";

export const runtime = "nodejs";

const MAX_DEPTH = 20; // 순환 참조 방어용 상한 (bom/route.ts와 동일)

interface EdgeRow {
  parent_item_code: string;
  parent_name: string;
  child_item_code: string;
  child_name: string;
  child_category: string;
  child_spec: string | null;
  qty_per: number;
  unit: string | null;
}

const EDGE_SELECT = `SELECT b.parent_item_code, p.item_name as parent_name,
         b.child_item_code, c.item_name as child_name, c.category as child_category,
         c.spec as child_spec, b.qty_per, b.unit
       FROM bom b
       JOIN items p ON p.item_code = b.parent_item_code
       JOIN items c ON c.item_code = b.child_item_code`;

// item_code가 있으면 그 완제품의 하위 트리(재귀)만, 없으면 전체 bom 테이블을 내려준다.
function collectDescendants(
  db: DatabaseSync,
  parentCode: string,
  ancestors: Set<string>,
  depth: number,
  out: EdgeRow[]
) {
  if (depth >= MAX_DEPTH) return;
  const direct = db
    .prepare(`${EDGE_SELECT} WHERE b.parent_item_code = ? ORDER BY b.child_item_code`)
    .all(parentCode) as unknown as EdgeRow[];
  for (const row of direct) {
    out.push(row);
    if (ancestors.has(row.child_item_code)) continue;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(row.child_item_code);
    collectDescendants(db, row.child_item_code, nextAncestors, depth + 1, out);
  }
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const itemCode = req.nextUrl.searchParams.get("item_code")?.trim();

  let rows: EdgeRow[];
  if (itemCode) {
    rows = [];
    collectDescendants(db, itemCode, new Set([itemCode]), 0, rows);
  } else {
    rows = db
      .prepare(`${EDGE_SELECT} ORDER BY b.parent_item_code, b.child_item_code`)
      .all() as unknown as EdgeRow[];
  }

  const data = rows.map((r) => ({
    상위품목코드: r.parent_item_code,
    상위품목명: r.parent_name,
    하위품목코드: r.child_item_code,
    하위품목명: r.child_name,
    하위구분: r.child_category,
    규격: r.child_spec,
    소요량: r.qty_per,
    단위: r.unit,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "BOM");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `bom_${itemCode || "전체"}_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
