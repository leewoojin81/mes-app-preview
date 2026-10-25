import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { LabelScheduleInput, LabelScheduleRow } from "@/lib/label-schedule-shared";
import { expiryDate, LABEL_INPUT_FIELDS } from "@/lib/label-schedule-shared";
import { ensureModelNameTables } from "@/lib/model-names";

// 공정관리 "마킹출하공정(PROC-06)" 라벨일정 — 엑셀 "라벨실적 업무.xlsx"의 라벨진행현황 시트를 옮긴 것(2026-10-23).
// 엑셀에서 VLOOKUP으로 끌어오던 칸은 MES 데이터에서 바로 계산하고, 사람이 적던 칸만 저장한다.
//   행 = 수주현황(sales_orders.detail)의 MO-번호 × 대표품목 (중단 수주 제외, MO-번호 끝의 탭/공백은 잘라냄), PLAN-01 작업순서 순
//   수주번호/고객사          수주현황 수주번호 · 거래처정보(BASE-06) 약칭 (약칭 미등록이면 화면에서 거래처명을 흐리게)
//   브랜드                   제품정보(BASE-01) 품목군 — 대표품목이 아니라 수주한 품목코드(도수 포함)로 찾는다
//                            (대표품목 행은 품목군이 비어 있거나 "."인 경우가 있어서, 2026-10-23 확인)
//   수주량                   같은 MO×대표품목 수주 수량 합(엑셀 SUMIFS처럼 샘플 포함)
//   주기/포장단위/형명       대표품목의 품목정보(items.detail 주기·포장단위수량·형명)
//   라벨                     수주량 ÷ 포장단위
//   유효기간                 형명별 유효기간(년) — 공통정보(BASE-10) 형명 표 model_names(2026-10-23부터, 예전 label_shelf_life는 안 씀)
//   유통기한                 생산일자 + 유효기간(년) − 1일 (엑셀 EDATE(생산일자, 년*12)-1)
//   라벨종류                 BOM정보(BASE-03)에서 대표품목의 BIL 자재 중 품명에 "라벨"이 든 것(단상자 라벨·측면 라벨·눈 라벨 등)을
//                            자재코드 순으로 " + "로 이어 표시, 없으면 "없음" (2026-10-23 — 직접 지정은 없앰, label_type 값은 남아 있지만 안 씀)
// 테이블은 CREATE만 한다. 처음 만들어질 때 엑셀에 적혀 있던 입력값(seed/label-schedule-seed.json)을 한 번만 넣는다.

const ensured = new WeakSet<DatabaseSync>();

export function ensureLabelScheduleTables(db: DatabaseSync): void {
  ensureModelNameTables(db); // 유효기간 = 공통정보(BASE-10) 형명 표
  if (ensured.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS label_schedule (
      mo_no TEXT NOT NULL,
      rep_item TEXT NOT NULL,
      work_date TEXT NOT NULL DEFAULT '',
      worker TEXT NOT NULL DEFAULT '',
      ship_lot TEXT NOT NULL DEFAULT '',
      prod_date TEXT NOT NULL DEFAULT '',
      label_type TEXT NOT NULL DEFAULT '',
      progress TEXT NOT NULL DEFAULT '',
      packing TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_by TEXT,
      PRIMARY KEY (mo_no, rep_item)
    );
    CREATE TABLE IF NOT EXISTS label_shelf_life (
      model_name TEXT PRIMARY KEY,
      years INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS label_schedule_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  seedIfNeeded(db);
  ensured.add(db);
}

function seedIfNeeded(db: DatabaseSync): void {
  const done = db.prepare("SELECT value FROM label_schedule_meta WHERE key = 'seeded'").get();
  if (done) return;
  const file = path.join(process.cwd(), "seed", "label-schedule-seed.json");
  if (!fs.existsSync(file)) return; // 시드 파일이 없으면 빈 상태로 시작
  const seed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    rows: ({ mo: string; item: string } & LabelScheduleInput)[];
    shelfLife: Record<string, number>;
  };
  db.exec("BEGIN");
  try {
    const ins = db.prepare(
      `INSERT OR IGNORE INTO label_schedule
         (mo_no, rep_item, work_date, worker, ship_lot, prod_date, label_type, progress, packing, note, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '엑셀이관')`
    );
    for (const r of seed.rows) {
      ins.run(r.mo, r.item, r.work_date, r.worker, r.ship_lot, r.prod_date, r.label_type, r.progress, r.packing, r.note);
    }
    const insSl = db.prepare("INSERT OR IGNORE INTO label_shelf_life (model_name, years) VALUES (?, ?)");
    for (const [name, years] of Object.entries(seed.shelfLife)) insSl.run(name, years);
    db.prepare("INSERT INTO label_schedule_meta (key, value) VALUES ('seeded', datetime('now','localtime'))").run();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function listLabelSchedule(db: DatabaseSync, from: string, to: string): LabelScheduleRow[] {
  ensureLabelScheduleTables(db);
  const rows = db
    .prepare(
      `WITH so AS (
         SELECT TRIM(json_extract(detail, '$."MO-번호"'), ' ' || char(9) || char(10) || char(13)) AS mo_no,
                json_extract(detail, '$.대표품목') AS rep_item,
                json_extract(detail, '$.수주번호') AS so_no,
                (SELECT json_extract(it.detail, '$.품목군') FROM items it WHERE it.item_code = sales_orders.item_code) AS brand,
                CAST(json_extract(detail, '$."작업순서"') AS INTEGER) AS seq,
                customer_code, order_qty, status, substr(created_at, 1, 10) AS order_date
           FROM sales_orders
          WHERE created_at >= ? AND created_at < date(?, '+1 day') AND status <> '중단'
       )
       SELECT so.mo_no, so.rep_item, MIN(so.so_no) AS so_no, MIN(so.brand) AS brand, MIN(so.order_date) AS order_date,
              NULLIF(TRIM(MIN(c.short_name)), '') AS customer,
              COALESCE(MIN(c.customer_name), MIN(so.customer_code)) AS customer_name,
              SUM(so.order_qty) AS order_qty, MIN(so.seq) AS seq,
              CASE WHEN MIN(so.status) = MAX(so.status) THEN MIN(so.status) ELSE '진행' END AS so_status,
              json_extract(i.detail, '$.주기') AS cycle,
              json_extract(i.detail, '$.포장단위수량') AS pack_unit,
              json_extract(i.detail, '$.형명') AS model_name,
              (SELECT group_concat(nm, ' + ') FROM (
                 SELECT DISTINCT bi.item_name AS nm FROM bom b JOIN items bi ON bi.item_code = b.child_item_code
                  WHERE b.parent_item_code = so.rep_item AND b.child_item_code LIKE 'BIL%' AND bi.item_name LIKE '%라벨%'
                  ORDER BY b.child_item_code)) AS bom_labels,
              ls.work_date, ls.worker, ls.ship_lot, ls.prod_date, ls.label_type, ls.progress, ls.packing, ls.note,
              ls.updated_at, ls.updated_by, sl.shelf_years AS shelf_years
         FROM so
         LEFT JOIN customers c ON c.customer_code = so.customer_code
         LEFT JOIN items i ON i.item_code = so.rep_item
         LEFT JOIN label_schedule ls ON ls.mo_no = so.mo_no AND ls.rep_item = so.rep_item
         LEFT JOIN model_names sl ON sl.model_name = json_extract(i.detail, '$.형명')
        WHERE so.mo_no IS NOT NULL AND so.mo_no <> '' AND so.rep_item IS NOT NULL
        GROUP BY so.mo_no, so.rep_item`
    )
    .all(from, to) as Record<string, string | number | null>[];
  // 순서 = 생산순위지정(PLAN-01) 작업순서(MO×대표품목 안의 가장 앞선 값) — 작업순서가 없는 줄(완료 등)은 뒤에 MO번호 역순.
  // 순위는 조회한 기간 안에서 작업순서가 있는 줄에 1부터 매긴다.
  rows.sort((a, b) => {
    const sa = a.seq == null ? null : Number(a.seq), sb = b.seq == null ? null : Number(b.seq);
    if (sa != null && sb != null && sa !== sb) return sa - sb;
    if ((sa == null) !== (sb == null)) return sa == null ? 1 : -1;
    const ma = String(a.mo_no), mb = String(b.mo_no);
    if (ma !== mb) return ma < mb ? 1 : -1;
    return String(a.rep_item) < String(b.rep_item) ? -1 : 1;
  });
  const s = (v: unknown) => (v == null ? "" : String(v));
  let rank = 0;
  return rows.map((r) => {
    const packUnit = Number(r.pack_unit) || null;
    const qty = Number(r.order_qty) || 0;
    const years = r.shelf_years == null ? null : Number(r.shelf_years);
    return {
      rank: r.seq == null ? null : ++rank,
      mo_no: s(r.mo_no),
      rep_item: s(r.rep_item),
      so_no: s(r.so_no),
      order_date: s(r.order_date),
      so_status: s(r.so_status),
      customer: s(r.customer),
      customer_name: s(r.customer_name),
      brand: s(r.brand),
      model: s(r.rep_item).slice(0, 5),
      cycle: s(r.cycle),
      order_qty: qty,
      pack_unit: packUnit,
      label_qty: packUnit ? qty / packUnit : null,
      model_name: s(r.model_name),
      shelf_years: years,
      bom_label: s(r.bom_labels) || "없음",
      work_date: s(r.work_date),
      worker: s(r.worker),
      ship_lot: s(r.ship_lot),
      prod_date: s(r.prod_date),
      label_type: s(r.label_type),
      progress: s(r.progress),
      packing: s(r.packing),
      note: s(r.note),
      expiry_date: expiryDate(s(r.prod_date), years),
      updated_at: s(r.updated_at),
      updated_by: s(r.updated_by),
    };
  });
}

export function saveLabelSchedule(
  db: DatabaseSync,
  moNo: string,
  repItem: string,
  input: Partial<LabelScheduleInput>,
  user: string | null
): void {
  ensureLabelScheduleTables(db);
  const fields = LABEL_INPUT_FIELDS.filter((f) => typeof input[f] === "string");
  if (fields.length === 0) return;
  db.prepare("INSERT OR IGNORE INTO label_schedule (mo_no, rep_item) VALUES (?, ?)").run(moNo, repItem);
  db.prepare(
    `UPDATE label_schedule SET ${fields.map((f) => `${f} = ?`).join(", ")},
            updated_at = datetime('now','localtime'), updated_by = ?
      WHERE mo_no = ? AND rep_item = ?`
  ).run(...fields.map((f) => String(input[f]).trim()), user, moNo, repItem);
}

// 형명별 유효기간의 원본은 공통정보(BASE-10) 형명 표(model_names)다(2026-10-23) — 이 화면의 유효기간 창도 그 표를 읽고 쓴다.
export function listShelfLife(db: DatabaseSync): { model_name: string; years: number }[] {
  ensureModelNameTables(db);
  return db.prepare("SELECT model_name, shelf_years AS years FROM model_names WHERE shelf_years IS NOT NULL ORDER BY model_name").all() as {
    model_name: string;
    years: number;
  }[];
}

export function setShelfLife(db: DatabaseSync, modelName: string, years: number | null): void {
  ensureModelNameTables(db);
  db.prepare(
    `INSERT INTO model_names (model_name, shelf_years, updated_by) VALUES (?, ?, '라벨일정')
     ON CONFLICT(model_name) DO UPDATE SET shelf_years = excluded.shelf_years, updated_at = datetime('now','localtime'), updated_by = '라벨일정'`
  ).run(modelName, years);
}
