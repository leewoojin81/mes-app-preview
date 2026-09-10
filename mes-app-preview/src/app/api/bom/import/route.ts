import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

// 엑셀의 "하위구분" 값을 items.category로 매핑. 반제품/원자재 외의 값(부자재 등)이나
// 빈 값은 원자재로 취급한다(scripts/import-bom.js의 보강 등록 규칙과 동일).
function mapChildCategory(raw: string): "반제품" | "원자재" {
  return raw.trim() === "반제품" ? "반제품" : "원자재";
}

// /api/bom/export가 내려주는 것과 같은 컬럼(상위품목코드/상위품목명/하위품목코드/
// 하위품목명/하위구분/규격/소요량/단위)의 엑셀을 읽어 bom 테이블에 반영한다.
// 상위/하위 품목코드가 아직 기준정보에 없으면 신규모델·신규 구성품으로 자동 등록한다
// (상위는 항상 완제품, 하위는 하위구분 기준).
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json(
      { error: "엑셀 파일을 읽을 수 없습니다. (.xlsx/.xls 파일인지 확인하세요)" },
      { status: 400 }
    );
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as (
    | string
    | number
    | null
  )[][];
  const header = (rows[0] ?? []).map((h) => (h == null ? "" : String(h).trim()));
  const idx = (name: string) => header.indexOf(name);
  const iParentCode = idx("상위품목코드");
  const iParentName = idx("상위품목명");
  const iChildCode = idx("하위품목코드");
  const iChildName = idx("하위품목명");
  const iChildCat = idx("하위구분");
  const iSpec = idx("규격");
  const iQty = idx("소요량");
  const iUnit = idx("단위");

  if (iParentCode === -1 || iChildCode === -1 || iQty === -1) {
    return NextResponse.json(
      {
        error:
          '첫 시트의 1행에서 "상위품목코드"·"하위품목코드"·"소요량" 컬럼을 찾을 수 없습니다.',
      },
      { status: 400 }
    );
  }

  const db = getDb();
  const itemExists = db.prepare("SELECT 1 FROM items WHERE item_code = ?");
  const insertItem = db.prepare(
    `INSERT INTO items (item_code, item_name, category, spec, unit) VALUES (?, ?, ?, ?, ?)`
  );
  const upsertBom = db.prepare(
    `INSERT INTO bom (bom_id, parent_item_code, child_item_code, qty_per, unit)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(parent_item_code, child_item_code) DO UPDATE SET
       qty_per = excluded.qty_per, unit = excluded.unit`
  );
  const existingPairs = new Set(
    (
      db.prepare("SELECT parent_item_code, child_item_code FROM bom").all() as {
        parent_item_code: string;
        child_item_code: string;
      }[]
    ).map((r) => `${r.parent_item_code}|${r.child_item_code}`)
  );
  const registeredCodes = new Set<string>();
  // 이번 업로드로 새로 생긴 완제품(신규모델)만 별도로 추적 — 이력(bom_model_log)용.
  const newModels = new Map<string, { name: string; childCount: number }>();

  let inserted = 0;
  let updated = 0;
  let registeredItems = 0;
  let skipped = 0;

  db.exec("BEGIN");
  try {
    for (const r of rows.slice(1)) {
      const parentCode = r[iParentCode] == null ? "" : String(r[iParentCode]).trim();
      const childCode = r[iChildCode] == null ? "" : String(r[iChildCode]).trim();
      const qtyRaw = r[iQty];
      const qty = typeof qtyRaw === "number" ? qtyRaw : Number(qtyRaw);
      if (!parentCode || !childCode || !Number.isFinite(qty)) {
        skipped++;
        continue;
      }

      const unit = iUnit !== -1 && r[iUnit] != null ? String(r[iUnit]).trim() : null;
      const spec = iSpec !== -1 && r[iSpec] != null ? String(r[iSpec]).trim() : null;

      if (!registeredCodes.has(parentCode) && !itemExists.get(parentCode)) {
        const name =
          iParentName !== -1 && r[iParentName] != null
            ? String(r[iParentName]).trim()
            : parentCode;
        insertItem.run(parentCode, name, "완제품", null, "EA");
        registeredCodes.add(parentCode);
        registeredItems++;
        newModels.set(parentCode, { name, childCount: 0 });
      }
      if (!registeredCodes.has(childCode) && !itemExists.get(childCode)) {
        const name =
          iChildName !== -1 && r[iChildName] != null ? String(r[iChildName]).trim() : childCode;
        const category = mapChildCategory(
          iChildCat !== -1 && r[iChildCat] != null ? String(r[iChildCat]) : ""
        );
        insertItem.run(childCode, name, category, spec, unit ?? "EA");
        registeredCodes.add(childCode);
        registeredItems++;
      }

      const model = newModels.get(parentCode);
      if (model) model.childCount++;

      const key = `${parentCode}|${childCode}`;
      upsertBom.run(key, parentCode, childCode, qty, unit);
      if (existingPairs.has(key)) updated++;
      else inserted++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  if (newModels.size > 0) {
    const insertLog = db.prepare(
      `INSERT INTO bom_model_log (item_code, item_name, source, child_count) VALUES (?, ?, '엑셀업로드', ?)`
    );
    for (const [code, { name, childCount }] of newModels) {
      insertLog.run(code, name, childCount);
    }
  }

  return NextResponse.json({ inserted, updated, registeredItems, skipped });
}
