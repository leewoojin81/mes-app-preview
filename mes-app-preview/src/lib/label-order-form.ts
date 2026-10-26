import type { DatabaseSync } from "node:sqlite";
import { ensureLabelScheduleTables } from "@/lib/label-schedule";
import { ensureShipLotTables, expiryText, prodText, type DateFmt } from "@/lib/ship-lot";
import type { OrderFormData, OrderFormInput, OrderFormLabel, OrderFormMo, OrderFormModel } from "@/lib/label-order-form-shared";
import { guessBrand, guessColor, powerOf } from "@/lib/label-order-form-shared";

// 마킹출하공정(PROC-06) 오더양식 — 엑셀 "1 오더양식(ANW) 형명추가ver.xlsx"(2026-10-26, ANW 전용).
// MO 하나 = 오더양식 한 장, 대표품목마다 모델 블록 하나. 엑셀에서 손으로 적던 칸을 MES 자료에서 채운다.
//   업체/관리번호/MES 관리번호   거래처 약칭 · MO-번호 · 수주번호
//   형명·B.C·DIA·입수·JAN        제품정보(BASE-01) — 대표품목(형명·B.C·DIA·포장단위수량), 도수 품목코드(JAN 코드)
//   샘플/오더                    수주현황 같은 MO×품목코드의 샘플구분 Sample / 일반 수량
//   출하LOT·제조일자·사용기한    SALES-04 출하LOT 탭 발행 값(ship_lots, 수주×대표품목)이 원본 — 다른 화면은 이 값을 가져다 쓴다(2026-10-26 사용자).
//                                미발행이면 라벨일정(PROC-06) 출하LOT·생산일자로 임시 표시하고 화면에 "미발행"을 띄운다
//   라벨코드                     BOM(BASE-03) 대표품목의 BIL 라벨 자재
//   유효기간(년)                 공통정보(BASE-10) 형명
// 저장하는 값(label_order_forms.data JSON)은 일련번호 · 라벨 사용량 · 불량 · 박스 라벨 설정(브랜드 · Color · 박스 종류 · 행 · 박스당 SET)뿐이다.

/** 오더양식 대상 거래처 — 약칭 또는 거래처명이 ANW */
const ANW_SQL = `customer_code IN (SELECT customer_code FROM customers WHERE UPPER(TRIM(COALESCE(short_name, ''))) = 'ANW' OR UPPER(TRIM(customer_name)) = 'ANW')`;
const MO_SQL = `TRIM(json_extract(detail, '$."MO-번호"'), ' ' || char(9) || char(10) || char(13))`;
const SO_SQL = `COALESCE(NULLIF(json_extract(detail, '$."수주번호"'), ''), so_no)`;
const ALIVE_SQL = `COALESCE(json_extract(detail, '$."상태"'), status) <> '중단'`;
const SAMPLE_SQL = `(json_extract(detail, '$."샘플구분"') LIKE '%sample%' OR json_extract(detail, '$."샘플구분"') LIKE '%샘플%')`;

const ensured = new WeakSet<DatabaseSync>();

function ensureTables(db: DatabaseSync): void {
  ensureLabelScheduleTables(db);
  ensureShipLotTables(db);
  if (ensured.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS label_order_forms (
      mo_no TEXT PRIMARY KEY,
      data TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_by TEXT
    );
  `);
  ensured.add(db);
}

/** 오더양식을 만들 수 있는 ANW MO — 수주일자 최근 순 */
export function listOrderFormMos(db: DatabaseSync, q: string): OrderFormMo[] {
  ensureTables(db);
  const rows = db
    .prepare(
      `WITH so AS (
         SELECT ${MO_SQL} mo_no, ${SO_SQL} so_no, json_extract(detail, '$."대표품목"') rep,
                (SELECT json_extract(it.detail, '$."품목군"') FROM items it WHERE it.item_code = sales_orders.item_code) brand,
                order_qty, substr(created_at, 1, 10) od
           FROM sales_orders WHERE ${ANW_SQL} AND ${ALIVE_SQL}
       )
       SELECT so.mo_no, group_concat(DISTINCT so.so_no) so_nos, group_concat(DISTINCT so.brand) brand, group_concat(DISTINCT so.rep) reps,
              SUM(so.order_qty) qty, MIN(so.od) od,
              (SELECT group_concat(DISTINCT lot_no) FROM ship_lots sl WHERE instr(',' || REPLACE(sl.mo_nos, ' ', '') || ',', ',' || so.mo_no || ',') > 0) ship_lot,
              EXISTS(SELECT 1 FROM label_order_forms f WHERE f.mo_no = so.mo_no) saved
         FROM so WHERE so.mo_no IS NOT NULL AND so.mo_no <> ''
        GROUP BY so.mo_no
        ORDER BY od DESC, so.mo_no DESC`
    )
    .all() as Record<string, string | number | null>[];
  const s = (v: unknown) => (v == null ? "" : String(v));
  const k = q.trim().toLowerCase();
  return rows
    .map((r) => ({
      mo_no: s(r.mo_no),
      so_nos: s(r.so_nos),
      brand: s(r.brand),
      reps: s(r.reps),
      qty: Number(r.qty) || 0,
      ship_lot: s(r.ship_lot),
      order_date: s(r.od),
      saved: !!r.saved,
    }))
    .filter((r) => !k || [r.mo_no, r.so_nos, r.brand, r.reps, r.ship_lot].some((x) => x.toLowerCase().includes(k)));
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return v == null || v === "" || !Number.isFinite(n) ? null : n;
};

export function getOrderForm(db: DatabaseSync, moNo: string): OrderFormData | null {
  ensureTables(db);
  const lines = db
    .prepare(
      `SELECT json_extract(detail, '$."대표품목"') rep, item_code, ${SO_SQL} so_no, customer_code,
              SUM(CASE WHEN ${SAMPLE_SQL} THEN order_qty ELSE 0 END) sample,
              SUM(CASE WHEN ${SAMPLE_SQL} THEN 0 ELSE order_qty END) ord
         FROM sales_orders
        WHERE ${MO_SQL} = ? AND ${ALIVE_SQL}
        GROUP BY rep, item_code`
    )
    .all(moNo) as { rep: string | null; item_code: string; so_no: string; customer_code: string | null; sample: number; ord: number }[];
  if (lines.length === 0) return null;

  const cust = lines.find((l) => l.customer_code)?.customer_code ?? null;
  const c = cust ? (db.prepare("SELECT short_name, customer_name FROM customers WHERE customer_code = ?").get(cust) as { short_name: string | null; customer_name: string } | undefined) : undefined;

  const itemStmt = db.prepare("SELECT item_name, detail FROM items WHERE item_code = ?");
  const janStmt = db.prepare(`SELECT json_extract(detail, '$."JAN 코드"') jan FROM items WHERE item_code = ?`);
  const labelStmt = db.prepare(
    `SELECT DISTINCT b.child_item_code code, bi.item_name name, COALESCE(bi.spec, '') spec
       FROM bom b JOIN items bi ON bi.item_code = b.child_item_code
      WHERE b.parent_item_code = ? AND b.child_item_code LIKE 'BIL%' AND bi.item_name LIKE '%라벨%'
      ORDER BY CASE WHEN bi.item_name LIKE '%단상자%' THEN 0 ELSE 1 END, b.child_item_code`
  );
  const lsStmt = db.prepare("SELECT ship_lot, prod_date, worker FROM label_schedule WHERE mo_no = ? AND rep_item = ?");
  const slStmt = db.prepare("SELECT lot_no, prod_date, date_fmt FROM ship_lots WHERE so_no = ? AND rep_item = ?");
  const yearsStmt = db.prepare("SELECT shelf_years FROM model_names WHERE model_name = ?");

  const reps = [...new Set(lines.map((l) => l.rep ?? (l.item_code.length >= 9 ? l.item_code.slice(0, 9) : l.item_code)))].sort();
  const models: OrderFormModel[] = reps.map((rep) => {
    const it = itemStmt.get(rep) as { item_name: string; detail: string | null } | undefined;
    const d = (it?.detail ? JSON.parse(it.detail) : {}) as Record<string, unknown>;
    // 대표품목 행의 품목군은 비어 있거나 "."인 경우가 있어(라벨일정과 같은 이유) 도수 품목코드에서 찾는다
    const first = lines.find((l) => (l.rep ?? "") === rep)?.item_code;
    const fd = first ? (itemStmt.get(first) as { item_name: string; detail: string | null } | undefined) : undefined;
    const fdd = (fd?.detail ? JSON.parse(fd.detail) : {}) as Record<string, unknown>;
    const group = String(fdd["품목군"] ?? d["품목군"] ?? "");
    const itemName = fd?.item_name ?? it?.item_name ?? "";
    const cycle = String(d["주기"] ?? "");
    const modelName = String(d["형명"] ?? "");
    const ls = lsStmt.get(moNo, rep) as { ship_lot: string; prod_date: string; worker: string } | undefined;
    const years = modelName ? (yearsStmt.get(modelName) as { shelf_years: number | null } | undefined)?.shelf_years ?? null : null;
    const sl = [...new Set(lines.filter((l) => (l.rep ?? "") === rep).map((l) => l.so_no))]
      .map((so) => slStmt.get(so, rep) as { lot_no: string; prod_date: string; date_fmt: DateFmt } | undefined)
      .find(Boolean);
    const prod = sl?.prod_date ?? ls?.prod_date ?? "";
    const dfmt: DateFmt = sl?.date_fmt ?? "ymd";
    const ml = lines
      .filter((l) => (l.rep ?? "") === rep)
      .map((l) => {
        const jan = (janStmt.get(l.item_code) as { jan: unknown } | undefined)?.jan;
        return { item_code: l.item_code, power: powerOf(l.item_code), sample: Number(l.sample) || 0, order: Number(l.ord) || 0, jan: jan == null || jan === "" ? "" : String(jan) };
      })
      .sort((a, b) => (b.power ?? -99) - (a.power ?? -99) || (a.item_code < b.item_code ? -1 : 1));
    return {
      rep_item: rep,
      model: rep.slice(0, 5),
      item_name: itemName,
      brand_default: guessBrand(group),
      color_default: guessColor(itemName, group, cycle),
      cycle,
      model_name: modelName,
      bc: num(d["B.C"]),
      dia: num(d["DIA(직경)"]),
      pack_unit: num(d["포장단위수량"]),
      box1: num(d["1 Box 수량"]),
      box2: num(d["2 Box 수량"]),
      labels: labelStmt.all(rep) as unknown as OrderFormLabel[],
      ship_lot: sl?.lot_no ?? ls?.ship_lot ?? "",
      prod_date: prod,
      expiry: prod ? expiryText(prod, years, dfmt) : "",
      prod_text: prod ? prodText(prod, dfmt) : "",
      issued: !!sl,
      worker: ls?.worker ?? "",
      shelf_years: years,
      lines: ml,
    };
  });

  const saved = db.prepare("SELECT data, updated_at, updated_by FROM label_order_forms WHERE mo_no = ?").get(moNo) as
    | { data: string; updated_at: string; updated_by: string | null }
    | undefined;
  let input: OrderFormInput = {};
  try {
    input = saved ? (JSON.parse(saved.data) as OrderFormInput) : {};
  } catch {
    input = {};
  }
  return {
    mo_no: moNo,
    so_nos: [...new Set(lines.map((l) => l.so_no))].sort(),
    customer: (c?.short_name ?? "").trim() || c?.customer_name || "",
    models,
    input,
    updated_at: saved?.updated_at ?? "",
    updated_by: saved?.updated_by ?? "",
  };
}

/** 입력값 정리 — 알 수 없는 키·잘못된 숫자는 버린다 */
function cleanInput(v: unknown): OrderFormInput {
  const o = (v ?? {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
  const s = (x: unknown) => (typeof x === "string" ? x.trim().slice(0, 200) : undefined);
  const models: OrderFormInput["models"] = {};
  for (const [k, m] of Object.entries((o.models ?? {}) as Record<string, Record<string, unknown>>)) {
    models[k] = {
      brand: s(m?.brand),
      color: s(m?.color),
      box_kind: m?.box_kind === "소" || m?.box_kind === "중" ? m.box_kind : undefined,
      box_rows: m?.box_rows === 1 || m?.box_rows === 2 ? m.box_rows : undefined,
      per_box: n(m?.per_box),
    };
  }
  const defects: OrderFormInput["defects"] = {};
  for (const [k, d] of Object.entries((o.defects ?? {}) as Record<string, Record<string, unknown>>)) {
    const sv = n(d?.s), tv = n(d?.t);
    if (sv || tv) defects[k] = { s: sv, t: tv };
  }
  return { serial: s(o.serial), label_use: n(o.label_use), memo: s(o.memo), models, defects };
}

export function saveOrderForm(db: DatabaseSync, moNo: string, input: unknown, user: string | null): void {
  ensureTables(db);
  db.prepare(
    `INSERT INTO label_order_forms (mo_no, data, updated_by) VALUES (?, ?, ?)
     ON CONFLICT(mo_no) DO UPDATE SET data = excluded.data, updated_at = datetime('now','localtime'), updated_by = excluded.updated_by`
  ).run(moNo, JSON.stringify(cleanInput(input)), user);
}
