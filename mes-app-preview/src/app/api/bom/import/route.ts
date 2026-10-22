import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordUpload } from "@/lib/master-meta";
import * as XLSX from "xlsx";
import { markHistoryActor } from "@/lib/history-actor";

export const runtime = "nodejs";

// 엑셀의 "하위구분" 값을 items.category로 매핑. 반제품/원자재 외의 값(부자재 등)이나
// 빈 값은 원자재로 취급한다(scripts/import-bom.js의 보강 등록 규칙과 동일).
function mapChildCategory(raw: string): "반제품" | "원자재" {
  return raw.trim() === "반제품" ? "반제품" : "원자재";
}

// ERP 품목정보는 "이름◆(규격)■(상세)" 한 칸이라 이름과 규격으로 나눈다(기준정보 items와 같은 방식).
function splitErpName(raw: string): { name: string; spec: string | null } {
  const i = raw.indexOf("◆");
  if (i === -1) return { name: raw.trim(), spec: null };
  const spec = raw.slice(i + 1).split("■")[0].trim().replace(/^\((.*)\)$/, "$1").trim();
  return { name: raw.slice(0, i).trim() || raw.trim(), spec: spec || null };
}

type Cell = string | number | null;

// ERP "BOM 정전개"(d_bimr210, Level 열로 단계를 표시하는 트리)를 요약조회(d_bimr220)와 같은
// 모품목 × 전체 하위 자재 줄로 펼친다 — 소요원수 = 경로의 표준원수를 곱한 값을 같은 자재끼리 합한 것
// (요약조회 파일과 대조해 일치 확인, 2026-10-22). 도수별 품목코드(끝 -0000 같은 4자리) 트리는
// 요약조회·기존 BOM처럼 대표코드만 두기 위해 건너뛴다.
function explodeTree(rows: Cell[][], header: string[]): { rows: Cell[][]; powerSkipped: number } {
  const col = (n: string) => header.indexOf(n);
  const iTop = col("모품목코드"), iLv = col("Level"), iChild = col("자품목코드"), iName = col("품목명");
  const iSpec = col("규격"), iAcct = col("계정"), iUnit = col("단위"), iQty = col("표준원수");
  const out = new Map<string, Cell[]>();
  const powerTops = new Set<string>();
  const cum: number[] = [];
  let topName: string | null = null;
  for (const r of rows.slice(1)) {
    const top = r[iTop] == null ? "" : String(r[iTop]).trim();
    const lvRaw = r[iLv];
    const lv = typeof lvRaw === "number" ? lvRaw : Number(String(lvRaw ?? "").replace(/\*/g, "").trim());
    if (!top || !Number.isInteger(lv) || lv < 0) continue; // 맨 아래 "Parent : n Rows" 합계 줄 등
    if (/-\d{4}$/.test(top)) {
      powerTops.add(top);
      continue;
    }
    if (lv === 0) {
      cum.length = 0;
      cum[0] = 1;
      const name = r[iName] == null ? top : String(r[iName]).trim();
      topName = r[iSpec] == null || String(r[iSpec]).trim() === "" ? name : `${name}◆(${String(r[iSpec]).trim()})`; // 요약조회의 모품목정보 모양
      continue;
    }
    const q = Number(r[iQty]);
    const v = (cum[lv - 1] ?? 1) * (Number.isFinite(q) ? q : NaN);
    cum[lv] = v;
    cum.length = lv + 1;
    const child = r[iChild] == null ? "" : String(r[iChild]).trim();
    const key = `${top}|${child}`;
    const prev = out.get(key);
    if (prev) prev[6] = (prev[6] as number) + v;
    else out.set(key, [top, topName, child, r[iName], r[iAcct], r[iSpec] == null ? null : String(r[iSpec]), v, r[iUnit]]);
  }
  for (const r of out.values()) r[6] = Math.round((r[6] as number) * 1e9) / 1e9; // 곱셈 부동소수 오차 정리
  return {
    rows: [["모품목코드", "모품목정보", "자품목코드", "자품목명", "계정", "규격", "소요원수", "단위"], ...out.values()],
    powerSkipped: powerTops.size,
  };
}

// /api/bom/export가 내려주는 것과 같은 컬럼(상위품목코드/상위품목명/하위품목코드/
// 하위품목명/하위구분/규격/소요량/단위)의 엑셀을 읽어 bom 테이블에 반영한다.
// 상위/하위 품목코드가 아직 기준정보에 없으면 신규모델·신규 구성품으로 자동 등록한다
// (상위는 항상 완제품, 하위는 하위구분 기준).
// ERP "BOM요약조회"·"BOM 정전개" 원본은 모품목별 전체 구성이라, 파일에 나온 모품목은 구성품을 파일과 똑같이 맞춘다
// (파일에 없는 기존 구성품 삭제 — 자재 리비전이 바뀌면 옛 코드가 남아 자재수급(PUR-03)에서 두 번 잡히던 문제).
// 파일에 없는 모품목과 내려받기 형식 업로드는 지금처럼 추가·수정만 한다.
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
  let rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as Cell[][];
  const cleanHeader = (r: Cell[] | undefined) => (r ?? []).map((h) => (h == null ? "" : String(h).replace(/[▲▼]/g, "").trim()));
  let header = cleanHeader(rows[0]);
  let powerSkipped = 0;
  if (header.includes("Level") && header.includes("표준원수")) {
    ({ rows, powerSkipped } = explodeTree(rows, header));
    header = cleanHeader(rows[0]);
  }
  // 내려받기 형식(상위품목코드…)과 ERP "BOM요약조회" 원본 형식(모품목코드/자품목코드/계정/소요원수),
  // ERP "BOM 정전개" 형식(위에서 요약조회 모양으로 펼침)을 모두 받는다.
  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const iParentCode = idx("상위품목코드", "모품목코드");
  const iParentName = idx("상위품목명", "모품목정보", "모품목명");
  const iChildCode = idx("하위품목코드", "자품목코드");
  const iChildName = idx("하위품목명", "자품목명");
  const iChildCat = idx("하위구분", "계정");
  const iSpec = idx("규격");
  const iQty = idx("소요량", "소요원수");
  const iUnit = idx("단위");
  const isErp = header.includes("모품목코드");

  if (iParentCode === -1 || iChildCode === -1 || iQty === -1) {
    return NextResponse.json(
      {
        error:
          '첫 시트의 1행에서 "상위품목코드(모품목코드)"·"하위품목코드(자품목코드)"·"소요량(소요원수 또는 정전개의 Level+표준원수)" 컬럼을 찾을 수 없습니다.',
      },
      { status: 400 }
    );
  }

  const db = getDb();
  markHistoryActor(db, req, { seconds: 900 });
  const itemExists = db.prepare("SELECT 1 FROM items WHERE item_code = ?");
  const insertItem = db.prepare(
    `INSERT INTO items (item_code, item_name, category, spec, unit) VALUES (?, ?, ?, ?, ?)`
  );
  const upsertBom = db.prepare(
    `INSERT INTO bom (bom_id, parent_item_code, child_item_code, qty_per, unit)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(parent_item_code, child_item_code) DO UPDATE SET
       qty_per = excluded.qty_per, unit = COALESCE(excluded.unit, bom.unit)`
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
  let deleted = 0;
  const filePairs = new Set<string>();

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
        const p = splitErpName(
          iParentName !== -1 && r[iParentName] != null ? String(r[iParentName]) : parentCode
        );
        insertItem.run(parentCode, p.name, "완제품", p.spec, "EA");
        registeredCodes.add(parentCode);
        registeredItems++;
        newModels.set(parentCode, { name: p.name, childCount: 0 });
      }
      if (!registeredCodes.has(childCode) && !itemExists.get(childCode)) {
        const c = splitErpName(
          iChildName !== -1 && r[iChildName] != null ? String(r[iChildName]) : childCode
        );
        const category = mapChildCategory(
          iChildCat !== -1 && r[iChildCat] != null ? String(r[iChildCat]) : ""
        );
        insertItem.run(childCode, c.name, category, spec ?? c.spec, unit ?? "EA");
        registeredCodes.add(childCode);
        registeredItems++;
      }

      const model = newModels.get(parentCode);
      if (model) model.childCount++;

      const key = `${parentCode}|${childCode}`;
      if (filePairs.has(key)) {
        updated++; // 같은 파일 안 중복 줄 — 뒤 줄 값으로 덮어씀
      } else if (existingPairs.has(key)) updated++;
      else inserted++;
      filePairs.add(key);
      upsertBom.run(key, parentCode, childCode, qty, unit);
    }
    if (isErp) {
      const fileParents = new Set([...filePairs].map((k) => k.slice(0, k.indexOf("|"))));
      const del = db.prepare("DELETE FROM bom WHERE parent_item_code = ? AND child_item_code = ?");
      for (const key of existingPairs) {
        const i = key.indexOf("|");
        const parent = key.slice(0, i);
        if (fileParents.has(parent) && !filePairs.has(key)) {
          del.run(parent, key.slice(i + 1));
          deleted++;
        }
      }
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

  recordUpload(db, "bom");
  return NextResponse.json({ inserted, updated, deleted, registeredItems, skipped, powerSkipped });
}
