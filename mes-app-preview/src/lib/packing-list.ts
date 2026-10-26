import type { DatabaseSync } from "node:sqlite";
import { shelfYearsOf } from "@/lib/model-names";

// 영업관리 "Packing List(SALES-04)" — 2026-10-23 사용자 요청. 공유폴더 "05 패킹리스트"의 DPL(Detailed Packing List)
// 엑셀을 MES 수주로 만든다. 수주(MO) 1건 = Packing List 1장.
//
// 박스 구성(기존 DPL 엑셀과 같다): 팩 → 소박스(Small Box) → 카톤(Ctn). 모델마다
//   팩 수 = 수주 수량(렌즈 개수) ÷ 포장단위수량(팩당 렌즈 수, 품목정보) — CLB 2P는 2, Uria 1day 10
//   도수 순(0.00 → -10.00)으로 소박스를 채우고(소박스 1개 = 한 도수, 끝수는 그 도수만 담은 소박스),
//   소박스를 차례로 카톤에 담는다. 모델이 바뀌면 새 카톤. 카톤 번호는 리스트 전체에서 이어진다.
//   기본값: 소박스 팩수 = 품목정보 "1 Box 수량", 카톤당 소박스 = "2 Box 수량" ÷ "1 Box 수량" — 화면에서 바꾼다.
// LOT = 출하LOT(SALES-04 출하LOT 탭 발행 값, 미발행이면 PROC-06 라벨일정 ship_lot, 예 6A1) + 모델 앞 5자리 + 도수코드(0.00→00, -1.25→12, -10.00→A0)
// 유효기간 = 제조일(출하LOT 발행 생산일자, 미발행이면 라벨일정) + 형명별 유효기간(년, 공통정보 BASE-10 형명 표, 없으면 5년) − 1일
// 무상·유상 샘플 줄은 기본으로 빼고(기존 DPL과 같음) 화면에서 넣을 수 있다.
// 확정하면 그 수주의 상태가 ERP 값이 '수주'일 때 MES 화면에서 'Packing'으로 보인다(packingStatusSql) — ERP 업로드가
// 수주 테이블을 다시 쓰므로 수주 테이블 자체는 고치지 않는다.

export type PackingForm = "std" | "cn";
export const PACKING_FORMS: { key: PackingForm; label: string }[] = [
  { key: "std", label: "표준 DPL (Carton · Small Box · LOT · 중량)" },
  { key: "cn", label: "중국 라벨형 (Ctn · 有效期 · 国际条形码 · 生产批号)" },
];
export const PL_STATUS = ["작성중", "확정", "취소"] as const;
export type PlStatus = (typeof PL_STATUS)[number];

export interface PackingModel {
  model: string;
  title: string;
  label_name: string;
  /** 팩당 렌즈 수(품목정보 포장단위수량) */
  pack_unit: number;
  /** 소박스 1개 팩 수 */
  per_small: number;
  /** 카톤 1개 소박스 수 */
  small_per_ctn: number;
  shelf_years: number;
  /** 수주 렌즈 수 / 팩 수 합 */
  order_qty: number;
  order_packs: number;
}

export interface PackingBox {
  id?: number;
  ctn_no: number;
  small_no: number;
  model: string;
  item_code: string;
  power: number | null;
  lot_no: string;
  qty: number;
}

export interface PackingList {
  pl_no: string;
  so_no: string;
  mo_no: string | null;
  customer: string | null;
  brand: string | null;
  due_date: string | null;
  form: PackingForm;
  status: PlStatus;
  lot_prefix: string;
  mfg_date: string;
  customer_po: string;
  remark: string;
  include_sample: boolean;
  revision: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  models: PackingModel[];
  boxes: PackingBox[];
  cartons: { ctn_no: number; net_kg: number | null; gross_kg: number | null }[];
  /** 품목코드 → JAN(바코드) */
  jan: Record<string, string>;
  /** 품목코드별 수주 팩 수 vs 박스 팩 수 */
  check: { item_code: string; model: string; power: number | null; order_packs: number; boxed: number }[];
}

export function ensurePackingTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS packing_lists (
      pl_no TEXT PRIMARY KEY,
      so_no TEXT NOT NULL,
      mo_no TEXT,
      form TEXT NOT NULL DEFAULT 'std',
      status TEXT NOT NULL DEFAULT '작성중',
      lot_prefix TEXT NOT NULL DEFAULT '',
      mfg_date TEXT NOT NULL DEFAULT '',
      customer_po TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      include_sample INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      confirmed_by TEXT,
      confirmed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_packing_lists_so_no ON packing_lists(so_no);
    CREATE TABLE IF NOT EXISTS packing_list_models (
      pl_no TEXT NOT NULL,
      model TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      label_name TEXT NOT NULL DEFAULT '',
      pack_unit REAL NOT NULL DEFAULT 1,
      per_small INTEGER NOT NULL DEFAULT 1,
      small_per_ctn INTEGER NOT NULL DEFAULT 1,
      shelf_years INTEGER NOT NULL DEFAULT 5,
      PRIMARY KEY (pl_no, model)
    );
    CREATE TABLE IF NOT EXISTS packing_list_boxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pl_no TEXT NOT NULL,
      ctn_no INTEGER NOT NULL,
      small_no INTEGER NOT NULL,
      model TEXT NOT NULL,
      item_code TEXT NOT NULL,
      power REAL,
      lot_no TEXT NOT NULL DEFAULT '',
      qty REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_packing_list_boxes_pl ON packing_list_boxes(pl_no, ctn_no, small_no);
    CREATE TABLE IF NOT EXISTS packing_list_cartons (
      pl_no TEXT NOT NULL,
      ctn_no INTEGER NOT NULL,
      net_kg REAL,
      gross_kg REAL,
      PRIMARY KEY (pl_no, ctn_no)
    );
    CREATE TABLE IF NOT EXISTS packing_item_jan (
      item_code TEXT PRIMARY KEY,
      jan TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
}

/** 수주 목록 상태 표시·필터용 SQL — ERP 상태가 '수주'인데 확정된 Packing List가 있으면 'Packing'. so = sales_orders 별칭 */
export function packingStatusSql(so = "so"): string {
  const base = `COALESCE(json_extract(${so}.detail, '$.상태'), ${so}.status)`;
  const sono = `COALESCE(NULLIF(json_extract(${so}.detail, '$.수주번호'), ''), CASE WHEN instr(${so}.so_no, '-') > 0 THEN substr(${so}.so_no, 1, instr(${so}.so_no, '-') - 1) ELSE ${so}.so_no END)`;
  return `CASE WHEN ${base} = '수주' AND EXISTS (SELECT 1 FROM packing_lists pl WHERE pl.so_no = ${sono} AND pl.status = '확정') THEN 'Packing' ELSE ${base} END`;
}

/** 수주 목록 행(detail JSON 파싱 후)에 확정 Packing List 상태를 덮어쓴다 */
export function overlayPackingStatus<T extends { so_no: string; detail: Record<string, unknown> | null }>(db: DatabaseSync, rows: T[]): T[] {
  ensurePackingTables(db);
  const set = new Set((db.prepare("SELECT DISTINCT so_no FROM packing_lists WHERE status = '확정'").all() as { so_no: string }[]).map((r) => r.so_no));
  if (!set.size) return rows;
  for (const r of rows) {
    if (!r.detail || r.detail["상태"] !== "수주") continue;
    const sono = String(r.detail["수주번호"] || soBase(r.so_no));
    if (set.has(sono)) r.detail = { ...r.detail, 상태: "Packing" };
  }
  return rows;
}

function soBase(soNo: string): string {
  const i = soNo.indexOf("-");
  return i > 0 ? soNo.slice(0, i) : soNo;
}

export function powerOf(itemCode: string): number | null {
  const m = /-(\d{4})$/.exec(itemCode);
  if (!m) return null;
  const v = -Number(m[1]) / 100;
  return v === 0 ? 0 : v;
}

/** LOT 도수코드 — 0.00→00, -0.50→05, -1.25→12, -9.50→95, -10.00→A0 */
export function powerCode(power: number | null): string {
  if (power == null) return "";
  const p = Math.abs(power);
  if (p >= 10) return `A${Math.floor(Math.round((p - 10) * 100) / 10)}`;
  return String(Math.floor(Math.round(p * 100) / 10)).padStart(2, "0");
}

export function lotOf(prefix: string, model: string, power: number | null): string {
  return prefix ? `${prefix}${model.slice(0, 5)}${powerCode(power)}` : "";
}

/** 제조일 + 유효기간(년) − 1일 (엑셀 EDATE(제조일, 년*12)-1과 같다) */
export function expiryOf(mfg: string, years: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(mfg);
  if (!m || !years) return "";
  const d = new Date(Number(m[1]) + years, Number(m[2]) - 1, Number(m[3]));
  if (d.getDate() !== Number(m[3])) d.setDate(0); // 2/29 → 2/28
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const SONO_SQL = `COALESCE(NULLIF(json_extract(detail, '$."수주번호"'), ''), CASE WHEN instr(so_no, '-') > 0 THEN substr(so_no, 1, instr(so_no, '-') - 1) ELSE so_no END)`;

/** 수주 목록(진행 중 + Packing List가 있는 수주) */
export function listOrders(db: DatabaseSync, q: string) {
  ensurePackingTables(db);
  const kw = `%${q.trim()}%`;
  return db
    .prepare(
      `WITH s AS (
         SELECT ${SONO_SQL} sono, detail, order_qty, due_date, COALESCE(json_extract(detail, '$."상태"'), status) st
           FROM sales_orders
       ), h AS (
         SELECT sono, MAX(json_extract(detail, '$."MO-번호"')) mo, MAX(json_extract(detail, '$."거래처명"')) customer,
                MAX(json_extract(detail, '$."품목군"')) brand, MIN(due_date) due, SUM(order_qty) qty,
                GROUP_CONCAT(DISTINCT st) sts
           FROM s WHERE st <> '중단' GROUP BY sono
       )
       SELECT h.*, pl.pl_no, pl.status pl_status, pl.revision
         FROM h LEFT JOIN packing_lists pl ON pl.so_no = h.sono AND pl.status <> '취소'
        WHERE (h.sts LIKE '%수주%' OR h.sts LIKE '%Packing%' OR pl.pl_no IS NOT NULL)
          AND (? = '%%' OR h.sono LIKE ? OR h.mo LIKE ? OR h.customer LIKE ? OR h.brand LIKE ?)
        ORDER BY (pl.pl_no IS NULL), h.due, h.sono
        LIMIT 300`
    )
    .all(kw, kw, kw, kw, kw) as {
    sono: string; mo: string | null; customer: string | null; brand: string | null; due: string | null; qty: number; sts: string;
    pl_no: string | null; pl_status: PlStatus | null; revision: number | null;
  }[];
}

type OrderItem = { item_code: string; model: string; power: number | null; qty: number };

function orderItems(db: DatabaseSync, soNo: string, includeSample: boolean): OrderItem[] {
  const rows = db
    .prepare(
      `SELECT item_code, SUM(order_qty) q FROM sales_orders
        WHERE ${SONO_SQL} = ? AND COALESCE(json_extract(detail, '$."상태"'), status) <> '중단'
          AND (? = 1 OR COALESCE(json_extract(detail, '$."샘플구분"'), '') NOT LIKE '%Sample%')
        GROUP BY item_code`
    )
    .all(soNo, includeSample ? 1 : 0) as { item_code: string; q: number }[];
  return rows
    .map((r) => ({ item_code: r.item_code, model: r.item_code.slice(0, 9), power: powerOf(r.item_code), qty: r.q ?? 0 }))
    .sort((a, b) => (a.model === b.model ? (b.power ?? 0) - (a.power ?? 0) : a.model < b.model ? -1 : 1));
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM pragma_table_list WHERE name = ?").get(name);
}

/** 모델 기본 설정 — 품목정보(포장단위수량·1 Box·2 Box 수량), 라벨일정 유효기간 */
function modelDefaults(db: DatabaseSync, model: string): Omit<PackingModel, "order_qty" | "order_packs"> {
  const it = (db.prepare("SELECT item_name, detail FROM items WHERE item_code = ?").get(model) ??
    db.prepare("SELECT item_name, detail FROM items WHERE item_code LIKE ? ORDER BY item_code LIMIT 1").get(`${model}-%`)) as
    | { item_name: string | null; detail: string | null }
    | undefined;
  const d = it?.detail ? (JSON.parse(it.detail) as Record<string, unknown>) : {};
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const packUnit = num(d["포장단위수량"]) || 1;
  const b1 = num(d["1 Box 수량"]);
  const b2 = num(d["2 Box 수량"]);
  const years = shelfYearsOf(db, d["형명"] == null ? null : String(d["형명"])) ?? 5;
  return {
    model,
    title: it?.item_name ?? model,
    label_name: "",
    pack_unit: packUnit,
    per_small: b1 || 100,
    small_per_ctn: b1 && b2 ? Math.max(1, Math.round(b2 / b1)) : 1,
    shelf_years: years,
  };
}

/** 소박스·카톤 나누기 — 모델별 도수 순, 소박스 1개 = 한 도수, 모델이 바뀌면 새 카톤 */
export function buildBoxes(items: OrderItem[], models: PackingModel[], lotPrefix: string): PackingBox[] {
  const boxes: PackingBox[] = [];
  let ctn = 0;
  for (const m of models) {
    const list = items.filter((i) => i.model === m.model);
    if (!list.length) continue;
    let small = m.small_per_ctn; // 다음 소박스에서 새 카톤 시작
    const per = Math.max(1, Math.floor(m.per_small));
    for (const it of list) {
      let packs = Math.round(it.qty / m.pack_unit);
      while (packs > 0) {
        const q = Math.min(per, packs);
        packs -= q;
        if (small >= m.small_per_ctn) {
          ctn++;
          small = 0;
        }
        small++;
        boxes.push({ ctn_no: ctn, small_no: small, model: m.model, item_code: it.item_code, power: it.power, lot_no: lotOf(lotPrefix, m.model, it.power), qty: q });
      }
    }
  }
  return boxes;
}

function nextPlNo(db: DatabaseSync): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const last = db.prepare("SELECT pl_no FROM packing_lists WHERE pl_no GLOB ? ORDER BY pl_no DESC LIMIT 1").get(`PL${ymd}*`) as { pl_no: string } | undefined;
  const n = last ? Number(last.pl_no.slice(10)) + 1 : 1;
  return `PL${ymd}${String(n).padStart(3, "0")}`;
}

/** 새 Packing List — 라벨일정(차수·제조일)과 품목정보 기본값으로 모델 설정을 채우고 박스를 나눈다 */
export function createPackingList(db: DatabaseSync, soNo: string, form: PackingForm, user: string | null): string {
  ensurePackingTables(db);
  const open = db.prepare("SELECT pl_no FROM packing_lists WHERE so_no = ? AND status <> '취소'").get(soNo) as { pl_no: string } | undefined;
  if (open) throw new Error(`이 수주에는 이미 Packing List(${open.pl_no})가 있습니다.`);
  const items = orderItems(db, soNo, false);
  if (!items.length) throw new Error("수주 품목이 없습니다.");
  const mo = (db.prepare(`SELECT MAX(json_extract(detail, '$."MO-번호"')) mo FROM sales_orders WHERE ${SONO_SQL} = ?`).get(soNo) as { mo: string | null }).mo;
  const modelCodes = [...new Set(items.map((i) => i.model))];
  let lotPrefix = "";
  let mfg = "";
  // 출하LOT·제조일자의 원본은 SALES-04 출하LOT 탭 발행 값(ship_lots, 수주×대표품목) — 미발행이면 라벨일정 값(2026-10-26)
  if (tableExists(db, "ship_lots")) {
    for (const r of db.prepare("SELECT rep_item, lot_no, prod_date FROM ship_lots WHERE so_no = ? ORDER BY rep_item").all(soNo) as { rep_item: string; lot_no: string; prod_date: string }[]) {
      if (!modelCodes.includes(r.rep_item)) continue;
      lotPrefix ||= r.lot_no ?? "";
      mfg ||= r.prod_date ?? "";
    }
  }
  if (!lotPrefix && mo && tableExists(db, "label_schedule")) {
    for (const r of db.prepare("SELECT rep_item, ship_lot, prod_date FROM label_schedule WHERE mo_no = ?").all(mo) as { rep_item: string; ship_lot: string; prod_date: string }[]) {
      if (!modelCodes.includes(r.rep_item)) continue;
      lotPrefix ||= r.ship_lot ?? "";
      mfg ||= r.prod_date ?? "";
    }
  }
  const plNo = nextPlNo(db);
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO packing_lists (pl_no, so_no, mo_no, form, lot_prefix, mfg_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(plNo, soNo, mo, form, lotPrefix, mfg, user);
    const insM = db.prepare(
      `INSERT INTO packing_list_models (pl_no, model, title, label_name, pack_unit, per_small, small_per_ctn, shelf_years) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const m of modelCodes) {
      const d = modelDefaults(db, m);
      insM.run(plNo, m, d.title, d.label_name, d.pack_unit, d.per_small, d.small_per_ctn, d.shelf_years);
    }
    writeBoxes(db, plNo, buildBoxes(items, loadModels(db, plNo, items), lotPrefix));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return plNo;
}

function loadModels(db: DatabaseSync, plNo: string, items: OrderItem[]): PackingModel[] {
  return (db.prepare("SELECT * FROM packing_list_models WHERE pl_no = ? ORDER BY model").all(plNo) as unknown as Omit<PackingModel, "order_qty" | "order_packs">[]).map((m) => {
    const qty = items.filter((i) => i.model === m.model).reduce((s, i) => s + i.qty, 0);
    return {
      model: m.model,
      title: m.title,
      label_name: m.label_name,
      pack_unit: m.pack_unit,
      per_small: m.per_small,
      small_per_ctn: m.small_per_ctn,
      shelf_years: m.shelf_years,
      order_qty: qty,
      order_packs: items.filter((i) => i.model === m.model).reduce((s, i) => s + Math.round(i.qty / m.pack_unit), 0),
    };
  });
}

function writeBoxes(db: DatabaseSync, plNo: string, boxes: PackingBox[]) {
  db.prepare("DELETE FROM packing_list_boxes WHERE pl_no = ?").run(plNo);
  const ins = db.prepare(`INSERT INTO packing_list_boxes (pl_no, ctn_no, small_no, model, item_code, power, lot_no, qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const b of boxes) ins.run(plNo, b.ctn_no, b.small_no, b.model, b.item_code, b.power, b.lot_no, b.qty);
  // 없어진 카톤의 중량은 지운다
  const max = boxes.reduce((s, b) => Math.max(s, b.ctn_no), 0);
  db.prepare("DELETE FROM packing_list_cartons WHERE pl_no = ? AND ctn_no > ?").run(plNo, max);
}

export function getPackingList(db: DatabaseSync, plNo: string): PackingList | null {
  ensurePackingTables(db);
  const h = db.prepare("SELECT * FROM packing_lists WHERE pl_no = ?").get(plNo) as Record<string, unknown> | undefined;
  if (!h) return null;
  const soNo = String(h.so_no);
  const includeSample = Number(h.include_sample) === 1;
  const items = orderItems(db, soNo, includeSample);
  const head = db
    .prepare(
      `SELECT MAX(json_extract(detail, '$."거래처명"')) customer, MAX(json_extract(detail, '$."품목군"')) brand, MIN(due_date) due
         FROM sales_orders WHERE ${SONO_SQL} = ?`
    )
    .get(soNo) as { customer: string | null; brand: string | null; due: string | null };
  const boxes = db.prepare("SELECT id, ctn_no, small_no, model, item_code, power, lot_no, qty FROM packing_list_boxes WHERE pl_no = ? ORDER BY ctn_no, small_no, id").all(plNo) as unknown as PackingBox[];
  const models = loadModels(db, plNo, items);
  const codes = [...new Set([...items.map((i) => i.item_code), ...boxes.map((b) => b.item_code)])];
  const jan: Record<string, string> = {};
  if (codes.length) {
    const qs = codes.map(() => "?").join(",");
    for (const r of db.prepare(`SELECT item_code, json_extract(detail, '$."JAN 코드"') j FROM items WHERE item_code IN (${qs})`).all(...codes) as { item_code: string; j: unknown }[]) {
      if (r.j != null && String(r.j).trim()) jan[r.item_code] = String(r.j).trim();
    }
    for (const r of db.prepare(`SELECT item_code, jan FROM packing_item_jan WHERE item_code IN (${qs})`).all(...codes) as { item_code: string; jan: string }[]) jan[r.item_code] = r.jan;
  }
  const boxed = new Map<string, number>();
  for (const b of boxes) boxed.set(b.item_code, (boxed.get(b.item_code) ?? 0) + b.qty);
  const unit = new Map(models.map((m) => [m.model, m.pack_unit]));
  const check = codes
    .map((c) => {
      const it = items.find((i) => i.item_code === c);
      const model = c.slice(0, 9);
      return { item_code: c, model, power: powerOf(c), order_packs: it ? Math.round(it.qty / (unit.get(model) ?? 1)) : 0, boxed: boxed.get(c) ?? 0 };
    })
    .sort((a, b) => (a.model === b.model ? (b.power ?? 0) - (a.power ?? 0) : a.model < b.model ? -1 : 1));
  const ctnMax = boxes.reduce((s, b) => Math.max(s, b.ctn_no), 0);
  const w = new Map(
    (db.prepare("SELECT ctn_no, net_kg, gross_kg FROM packing_list_cartons WHERE pl_no = ?").all(plNo) as { ctn_no: number; net_kg: number | null; gross_kg: number | null }[]).map((r) => [r.ctn_no, r])
  );
  return {
    pl_no: plNo,
    so_no: soNo,
    mo_no: (h.mo_no as string) ?? null,
    customer: head?.customer ?? null,
    brand: head?.brand ?? null,
    due_date: head?.due ?? null,
    form: h.form === "cn" ? "cn" : "std",
    status: h.status as PlStatus,
    lot_prefix: String(h.lot_prefix ?? ""),
    mfg_date: String(h.mfg_date ?? ""),
    customer_po: String(h.customer_po ?? ""),
    remark: String(h.remark ?? ""),
    include_sample: includeSample,
    revision: Number(h.revision ?? 0),
    created_by: (h.created_by as string) ?? null,
    created_at: String(h.created_at),
    updated_at: String(h.updated_at),
    confirmed_by: (h.confirmed_by as string) ?? null,
    confirmed_at: (h.confirmed_at as string) ?? null,
    models,
    boxes,
    cartons: Array.from({ length: ctnMax }, (_, i) => ({ ctn_no: i + 1, net_kg: w.get(i + 1)?.net_kg ?? null, gross_kg: w.get(i + 1)?.gross_kg ?? null })),
    jan,
    check,
  };
}

export interface PackingSave {
  form?: PackingForm;
  lot_prefix?: string;
  mfg_date?: string;
  customer_po?: string;
  remark?: string;
  include_sample?: boolean;
  models?: { model: string; title?: string; label_name?: string; pack_unit?: number; per_small?: number; small_per_ctn?: number; shelf_years?: number }[];
  /** 박스 줄 전체(화면에서 고친 그대로) — 없으면 그대로 둔다 */
  boxes?: PackingBox[];
  cartons?: { ctn_no: number; net_kg: number | null; gross_kg: number | null }[];
  jan?: Record<string, string>;
  /** true면 모델 설정으로 박스를 다시 나눈다(boxes 무시) */
  rebuild?: boolean;
}

/** 작성중인 Packing List 저장 */
export function savePackingList(db: DatabaseSync, plNo: string, s: PackingSave, user: string | null) {
  const cur = getPackingList(db, plNo);
  if (!cur) throw new Error("Packing List가 없습니다.");
  if (cur.status !== "작성중") throw new Error("확정된 Packing List는 고칠 수 없습니다. 확정을 풀고 고쳐 주세요.");
  const pos = (v: unknown, min = 1) => (Number.isFinite(Number(v)) && Number(v) >= min ? Number(v) : null);
  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE packing_lists SET form = ?, lot_prefix = ?, mfg_date = ?, customer_po = ?, remark = ?, include_sample = ?, updated_at = datetime('now','localtime') WHERE pl_no = ?`
    ).run(
      s.form === "cn" || s.form === "std" ? s.form : cur.form,
      (s.lot_prefix ?? cur.lot_prefix).trim(),
      /^\d{4}-\d{2}-\d{2}$/.test(s.mfg_date ?? "") ? s.mfg_date! : s.mfg_date === "" ? "" : cur.mfg_date,
      (s.customer_po ?? cur.customer_po).trim(),
      (s.remark ?? cur.remark).trim(),
      (s.include_sample ?? cur.include_sample) ? 1 : 0,
      plNo
    );
    for (const m of s.models ?? []) {
      const old = cur.models.find((x) => x.model === m.model);
      if (!old) continue;
      db.prepare(
        `UPDATE packing_list_models SET title = ?, label_name = ?, pack_unit = ?, per_small = ?, small_per_ctn = ?, shelf_years = ? WHERE pl_no = ? AND model = ?`
      ).run(
        (m.title ?? old.title).trim(),
        (m.label_name ?? old.label_name).trim(),
        pos(m.pack_unit) ?? old.pack_unit,
        Math.floor(pos(m.per_small) ?? old.per_small),
        Math.floor(pos(m.small_per_ctn) ?? old.small_per_ctn),
        Math.floor(pos(m.shelf_years) ?? old.shelf_years),
        plNo,
        m.model
      );
    }
    // 샘플 포함 여부가 바뀌면 수주 품목에 없던 모델이 생길 수 있다 — 모델 설정 줄을 맞춘다
    const items = orderItems(db, cur.so_no, (s.include_sample ?? cur.include_sample) === true);
    for (const m of new Set(items.map((i) => i.model))) {
      if (cur.models.some((x) => x.model === m)) continue;
      const d = modelDefaults(db, m);
      db.prepare(
        `INSERT OR IGNORE INTO packing_list_models (pl_no, model, title, label_name, pack_unit, per_small, small_per_ctn, shelf_years) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(plNo, m, d.title, d.label_name, d.pack_unit, d.per_small, d.small_per_ctn, d.shelf_years);
    }
    const prefix = (s.lot_prefix ?? cur.lot_prefix).trim();
    if (s.rebuild) {
      writeBoxes(db, plNo, buildBoxes(items, loadModels(db, plNo, items), prefix));
    } else if (s.boxes) {
      const clean = s.boxes
        .filter((b) => b.item_code && pos(b.qty, 0.0001) != null && pos(b.ctn_no) != null && pos(b.small_no) != null)
        .map((b) => ({ ...b, item_code: b.item_code.trim(), model: b.item_code.trim().slice(0, 9), power: powerOf(b.item_code.trim()), lot_no: (b.lot_no ?? "").trim() }));
      writeBoxes(db, plNo, clean);
    }
    if (s.cartons) {
      const up = db.prepare(
        `INSERT INTO packing_list_cartons (pl_no, ctn_no, net_kg, gross_kg) VALUES (?, ?, ?, ?)
         ON CONFLICT(pl_no, ctn_no) DO UPDATE SET net_kg = excluded.net_kg, gross_kg = excluded.gross_kg`
      );
      const kg = (v: unknown) => (v === null || v === "" || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
      for (const c of s.cartons) if (pos(c.ctn_no) != null) up.run(plNo, c.ctn_no, kg(c.net_kg), kg(c.gross_kg));
    }
    if (s.jan) {
      const up = db.prepare(
        `INSERT INTO packing_item_jan (item_code, jan, updated_by, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))
         ON CONFLICT(item_code) DO UPDATE SET jan = excluded.jan, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      );
      const del = db.prepare("DELETE FROM packing_item_jan WHERE item_code = ?");
      for (const [code, j] of Object.entries(s.jan)) {
        const v = String(j ?? "").trim();
        if (v) up.run(code, v, user);
        else del.run(code);
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** 확정 / 확정 취소(다시 작성중, 개정번호 +1) / 삭제(작성중만 — 취소 상태로 남긴다) */
export function setPackingStatus(db: DatabaseSync, plNo: string, action: "confirm" | "reopen" | "cancel", user: string | null) {
  const cur = getPackingList(db, plNo);
  if (!cur) throw new Error("Packing List가 없습니다.");
  if (action === "confirm") {
    if (cur.status !== "작성중") throw new Error("작성중인 Packing List만 확정할 수 있습니다.");
    if (!cur.boxes.length) throw new Error("박스가 없습니다.");
    db.prepare("UPDATE packing_lists SET status = '확정', confirmed_by = ?, confirmed_at = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE pl_no = ?").run(user, plNo);
  } else if (action === "reopen") {
    if (cur.status !== "확정") throw new Error("확정된 Packing List만 확정을 풀 수 있습니다.");
    db.prepare("UPDATE packing_lists SET status = '작성중', revision = revision + 1, confirmed_by = NULL, confirmed_at = NULL, updated_at = datetime('now','localtime') WHERE pl_no = ?").run(plNo);
  } else {
    if (cur.status !== "작성중") throw new Error("작성중인 Packing List만 취소할 수 있습니다.");
    db.prepare("UPDATE packing_lists SET status = '취소', updated_at = datetime('now','localtime') WHERE pl_no = ?").run(plNo);
  }
}
