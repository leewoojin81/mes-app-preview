import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

// 기준정보 "공통정보(BASE-10)" 형명 탭 — 품질 문서 "F706-3 형명식별기호 관리대장"(2025-12-12판)을 옮긴 것(2026-10-23 사용자 요청).
// 형명(예: 38-HR)마다 허가품목·유효기간(년)·UV·pH·원료(구분/기호)와, 원료로트 식별 → 형명식별 기호 짝(여러 개)을 둔다.
// 형명별 유효기간은 여기가 원본이다 — 마킹출하공정(PROC-06) 라벨일정의 유통기한, Packing List(SALES-04)의 유효기간이 이 값을 쓴다
// (예전 PROC-06 label_shelf_life 표는 더 쓰지 않는다. 처음 만들 때 그 표에만 있던 형명은 옮겨 온다).
// 품목정보(BASE-01)의 "형명" 값과 이름으로 이어진다. 변경은 기준정보변경이력(BASE-20) 트리거가 남긴다.

export interface ModelNameLot {
  raw_lot: string;
  symbol: string;
}

export interface ModelName {
  model_name: string;
  /** 관리대장 연번(허가품목 번호 — 한 허가품목에 형명이 여럿일 수 있다) */
  list_no: number | null;
  permit_item: string;
  shelf_years: number | null;
  uv_yn: "Y" | "N";
  ph: string;
  material_type: string;
  material_code: string;
  note: string;
  use_yn: "Y" | "N";
  updated_at: string | null;
  updated_by: string | null;
  lots: ModelNameLot[];
  /** 품목정보에서 이 형명을 쓰는 품목 수 */
  item_count: number;
}

export function ensureModelNameTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_names (
      model_name TEXT PRIMARY KEY,
      list_no INTEGER,
      permit_item TEXT NOT NULL DEFAULT '',
      shelf_years INTEGER,
      uv_yn TEXT NOT NULL DEFAULT 'N',
      ph TEXT NOT NULL DEFAULT '',
      material_type TEXT NOT NULL DEFAULT '',
      material_code TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      use_yn TEXT NOT NULL DEFAULT 'Y',
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS model_name_lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT NOT NULL,
      raw_lot TEXT NOT NULL DEFAULT '',
      symbol TEXT NOT NULL DEFAULT '',
      sort_no INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_model_name_lots_name ON model_name_lots(model_name, sort_no);
  `);
  const n = (db.prepare("SELECT COUNT(*) n FROM model_names").get() as { n: number }).n;
  if (n === 0) seed(db);
}

/** 처음 한 번 — 관리대장 시드(seed/model-names-seed.json) + PROC-06 label_shelf_life에만 있던 형명 */
function seed(db: DatabaseSync) {
  const file = path.join(process.cwd(), "seed", "model-names-seed.json");
  const rows = fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as {
        rows: { name: string; seq: number | null; permit_item: string; shelf_years: number | null; uv: string; ph: string; material_type: string; material_code: string; lots: ModelNameLot[] }[];
      }).rows
    : [];
  db.exec("BEGIN");
  try {
    const ins = db.prepare(
      `INSERT OR IGNORE INTO model_names (model_name, list_no, permit_item, shelf_years, uv_yn, ph, material_type, material_code, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '관리대장 이관')`
    );
    const insLot = db.prepare("INSERT INTO model_name_lots (model_name, raw_lot, symbol, sort_no) VALUES (?, ?, ?, ?)");
    for (const r of rows) {
      ins.run(r.name, r.seq, r.permit_item, r.shelf_years, r.uv === "Y" ? "Y" : "N", r.ph, r.material_type, r.material_code);
      r.lots.forEach((l, i) => insLot.run(r.name, l.raw_lot, l.symbol, i + 1));
    }
    if (db.prepare("SELECT 1 FROM pragma_table_list WHERE name = 'label_shelf_life'").get()) {
      for (const r of db.prepare("SELECT model_name, years FROM label_shelf_life").all() as { model_name: string; years: number }[]) {
        db.prepare("INSERT OR IGNORE INTO model_names (model_name, shelf_years, updated_by) VALUES (?, ?, '라벨일정 이관')").run(r.model_name, r.years);
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function listModelNames(db: DatabaseSync): ModelName[] {
  ensureModelNameTables(db);
  const counts = new Map(
    (db.prepare(`SELECT json_extract(detail, '$."형명"') h, COUNT(*) n FROM items WHERE json_extract(detail, '$."형명"') IS NOT NULL GROUP BY 1`).all() as { h: string; n: number }[]).map(
      (r) => [String(r.h).trim(), r.n]
    )
  );
  const lots = new Map<string, ModelNameLot[]>();
  for (const l of db.prepare("SELECT model_name, raw_lot, symbol FROM model_name_lots ORDER BY model_name, sort_no, id").all() as unknown as ({ model_name: string } & ModelNameLot)[]) {
    const list = lots.get(l.model_name) ?? [];
    list.push({ raw_lot: l.raw_lot, symbol: l.symbol });
    lots.set(l.model_name, list);
  }
  return (db.prepare("SELECT * FROM model_names ORDER BY list_no IS NULL, list_no, model_name").all() as unknown as Omit<ModelName, "lots" | "item_count">[]).map((m) => ({
    ...m,
    lots: lots.get(m.model_name) ?? [],
    item_count: counts.get(m.model_name) ?? 0,
  }));
}

/** 형명 → 유효기간(년) — 라벨일정·Packing List용 */
export function shelfYearsOf(db: DatabaseSync, modelName: string | null | undefined): number | null {
  if (!modelName) return null;
  ensureModelNameTables(db);
  const r = db.prepare("SELECT shelf_years y FROM model_names WHERE model_name = ?").get(modelName.trim()) as { y: number | null } | undefined;
  return r?.y ?? null;
}

export type ModelNameInput = Partial<Omit<ModelName, "updated_at" | "updated_by" | "item_count">> & { model_name: string };

function clean(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** 등록(create=true) 또는 수정. 원료로트 짝은 바뀐 것만 넣고 뺀다(변경이력이 짝마다 남도록) */
export function saveModelName(db: DatabaseSync, input: ModelNameInput, create: boolean, user: string | null) {
  ensureModelNameTables(db);
  const name = clean(input.model_name);
  if (!name) throw new Error("형명을 입력하세요.");
  const exists = !!db.prepare("SELECT 1 FROM model_names WHERE model_name = ?").get(name);
  if (create && exists) throw new Error(`이미 있는 형명입니다: ${name}`);
  if (!create && !exists) throw new Error(`없는 형명입니다: ${name}`);
  const num = (v: unknown, max: number) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new Error("숫자 칸을 확인하세요.");
    return n;
  };
  const yn = (v: unknown, d: "Y" | "N") => (v === "Y" || v === "N" ? v : d);
  db.exec("BEGIN");
  try {
    if (create) db.prepare("INSERT INTO model_names (model_name, updated_by) VALUES (?, ?)").run(name, user);
    const cur = db.prepare("SELECT * FROM model_names WHERE model_name = ?").get(name) as Record<string, unknown>;
    const pick = <K extends string>(k: K, f: (v: unknown) => unknown) => (k in input ? f((input as Record<string, unknown>)[k]) : cur[k]);
    db.prepare(
      `UPDATE model_names SET list_no = ?, permit_item = ?, shelf_years = ?, uv_yn = ?, ph = ?, material_type = ?, material_code = ?, note = ?, use_yn = ?,
              updated_at = datetime('now','localtime'), updated_by = ? WHERE model_name = ?`
    ).run(
      pick("list_no", (v) => num(v, 9999)) as number | null,
      pick("permit_item", clean) as string,
      pick("shelf_years", (v) => num(v, 50)) as number | null,
      pick("uv_yn", (v) => yn(v, "N")) as string,
      pick("ph", clean) as string,
      pick("material_type", clean) as string,
      pick("material_code", clean) as string,
      pick("note", clean) as string,
      pick("use_yn", (v) => yn(v, "Y")) as string,
      user,
      name
    );
    if (input.lots) {
      const want = input.lots.map((l) => ({ raw_lot: clean(l.raw_lot), symbol: clean(l.symbol) })).filter((l) => l.raw_lot || l.symbol);
      const have = db.prepare("SELECT id, raw_lot, symbol FROM model_name_lots WHERE model_name = ? ORDER BY sort_no, id").all(name) as unknown as ({ id: number } & ModelNameLot)[];
      const used = new Set<number>();
      want.forEach((w, i) => {
        const hit = have.find((h) => !used.has(h.id) && h.raw_lot === w.raw_lot && h.symbol === w.symbol);
        if (hit) {
          used.add(hit.id);
          db.prepare("UPDATE model_name_lots SET sort_no = ? WHERE id = ?").run(i + 1, hit.id);
        } else {
          db.prepare("INSERT INTO model_name_lots (model_name, raw_lot, symbol, sort_no) VALUES (?, ?, ?, ?)").run(name, w.raw_lot, w.symbol, i + 1);
        }
      });
      for (const h of have) if (!used.has(h.id)) db.prepare("DELETE FROM model_name_lots WHERE id = ?").run(h.id);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** 삭제 — 품목정보에서 쓰는 형명은 지우지 않는다(사용여부 N으로) */
export function deleteModelName(db: DatabaseSync, modelName: string) {
  ensureModelNameTables(db);
  const n = (db.prepare(`SELECT COUNT(*) n FROM items WHERE json_extract(detail, '$."형명"') = ?`).get(modelName) as { n: number }).n;
  if (n > 0) throw new Error(`품목 ${n.toLocaleString("ko-KR")}개가 이 형명을 씁니다. 삭제 대신 사용여부를 N으로 바꿔 주세요.`);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM model_name_lots WHERE model_name = ?").run(modelName);
    db.prepare("DELETE FROM model_names WHERE model_name = ?").run(modelName);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
