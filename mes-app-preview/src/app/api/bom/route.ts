import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull, strOrNull, strVal } from "@/lib/item-fields";
import type { BomRow, Item } from "@/lib/types";
import type { DatabaseSync } from "node:sqlite";

export const runtime = "nodejs";

const MAX_DEPTH = 20; // 순환 참조 방어용 상한 (실제 데이터는 최대 5단계)

function loadChildren(
  db: DatabaseSync,
  parentCode: string,
  ancestors: Set<string>,
  depth: number
): BomRow[] {
  if (depth >= MAX_DEPTH) return [];

  const direct = db
    .prepare(
      `SELECT b.child_item_code, it.item_name, it.category, it.spec, it.unit, b.qty_per
       FROM bom b
       JOIN items it ON it.item_code = b.child_item_code
       WHERE b.parent_item_code = ?
       ORDER BY b.child_item_code`
    )
    .all(parentCode) as Omit<BomRow, "children">[];

  return direct.map((row) => {
    if (ancestors.has(row.child_item_code)) {
      return { ...row, children: [] };
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(row.child_item_code);
    return {
      ...row,
      children: loadChildren(db, row.child_item_code, nextAncestors, depth + 1),
    };
  });
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const itemCode = req.nextUrl.searchParams.get("item_code")?.trim();

  if (!itemCode) {
    return NextResponse.json({ parent: null, rows: [] });
  }

  const parent = (db
    .prepare("SELECT * FROM items WHERE item_code = ?")
    .get(itemCode) ?? null) as Item | null;

  const rows = loadChildren(db, itemCode, new Set([itemCode]), 0);

  return NextResponse.json({ parent, rows });
}

// 신규 모델(완제품) 등록 + 구성품(BOM) 한 번에 저장. 상위품목이 기준정보에 아직 없으면
// (신규모델) 완제품으로 새로 등록하고, 하위 구성품은 반드시 기존 품목이어야 한다
// (신규 구성품은 제품등록/자재등록에서 먼저 등록하도록 안내).
export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const parentInput = body.parent ?? {};
  const parentCode = strVal(parentInput.item_code);
  if (!parentCode) {
    return NextResponse.json({ error: "완제품코드는 필수입니다." }, { status: 400 });
  }

  const rowsInput = Array.isArray(body.rows) ? body.rows : [];
  if (rowsInput.length === 0) {
    return NextResponse.json({ error: "구성품을 1건 이상 입력해주세요." }, { status: 400 });
  }

  const parsedRows: { child_item_code: string; qty_per: number; unit: string | null }[] = [];
  for (const row of rowsInput) {
    const childCode = strVal(row.child_item_code);
    if (!childCode) continue; // 빈 행은 조용히 건너뜀(폼에서 채우다 만 여분 행)
    const qty = numOrNull(row.qty_per);
    if (qty === undefined || qty === null || qty <= 0) {
      return NextResponse.json(
        { error: `${childCode}의 소요량이 올바르지 않습니다.` },
        { status: 400 }
      );
    }
    parsedRows.push({ child_item_code: childCode, qty_per: qty, unit: strOrNull(row.unit) });
  }
  if (parsedRows.length === 0) {
    return NextResponse.json({ error: "구성품을 1건 이상 입력해주세요." }, { status: 400 });
  }

  const childCodes = [...new Set(parsedRows.map((r) => r.child_item_code))];
  const existingChildren = new Set(
    (
      db
        .prepare(
          `SELECT item_code FROM items WHERE item_code IN (${childCodes.map(() => "?").join(",")})`
        )
        .all(...childCodes) as { item_code: string }[]
    ).map((r) => r.item_code)
  );
  const missing = childCodes.filter((c) => !existingChildren.has(c));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `기준정보에 없는 구성품입니다. 먼저 제품등록/자재등록에서 등록해주세요: ${missing.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const parentExists = db.prepare("SELECT 1 FROM items WHERE item_code = ?").get(parentCode);
  let isNewModel = false;
  let newModelName = "";
  if (!parentExists) {
    const parentName = strVal(parentInput.item_name);
    if (!parentName) {
      return NextResponse.json(
        { error: "신규 완제품은 품목명이 필수입니다." },
        { status: 400 }
      );
    }
    db.prepare(
      `INSERT INTO items (item_code, item_name, category, spec, unit) VALUES (?, ?, '완제품', ?, ?)`
    ).run(parentCode, parentName, strOrNull(parentInput.spec), strOrNull(parentInput.unit) ?? "EA");
    isNewModel = true;
    newModelName = parentName;
  }

  const existingPairs = new Set(
    (
      db
        .prepare("SELECT child_item_code FROM bom WHERE parent_item_code = ?")
        .all(parentCode) as { child_item_code: string }[]
    ).map((r) => r.child_item_code)
  );
  const upsertBom = db.prepare(
    `INSERT INTO bom (bom_id, parent_item_code, child_item_code, qty_per, unit)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(parent_item_code, child_item_code) DO UPDATE SET
       qty_per = excluded.qty_per, unit = excluded.unit`
  );

  let inserted = 0;
  let updated = 0;
  db.exec("BEGIN");
  try {
    for (const row of parsedRows) {
      const bomId = `${parentCode}|${row.child_item_code}`;
      upsertBom.run(bomId, parentCode, row.child_item_code, row.qty_per, row.unit);
      if (existingPairs.has(row.child_item_code)) updated++;
      else inserted++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  if (isNewModel) {
    db.prepare(
      `INSERT INTO bom_model_log (item_code, item_name, source, child_count) VALUES (?, ?, '직접등록', ?)`
    ).run(parentCode, newModelName, parsedRows.length);
  }

  return NextResponse.json({ ok: true, parent_item_code: parentCode, inserted, updated });
}
