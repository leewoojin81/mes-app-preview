import type { DatabaseSync } from "node:sqlite";
import { expiryDate } from "@/lib/label-schedule-shared";
import { ensureLabelScheduleTables } from "@/lib/label-schedule";
import { ensureModelNameTables } from "@/lib/model-names";
import { fetchDueOrders } from "@/lib/due-orders";

// 영업관리 Packing List(SALES-04) "출하LOT" 탭 — 2026-10-25 사용자 요청.
// 영업이 출하LOT 번호를 정해 배포하면 라벨 쪽이 엑셀에 옮겨 적고 라벨·마킹에 인쇄하던 일을 MES에서 한다.
//   출하LOT = 연도 끝자리 + 월코드(1~9, A=10월, B=11월, C=12월) + 출하차수(그 달 1, 2, …)   예) 6A1 = 2026년 10월 1차
//            월은 생산일자의 연·월. 같은 달 다른 MO와 같은 LOT로 묶을 수도 있다(같이 출하).
//   생산일자 표기 = 국가별·형명별 규칙(ship_lot_date_rules)에 따라 제조년월(2026-10) 또는 제조년월일(2026-10-19), 규칙 없으면 년월일
//   사용기한   = 년월일: 생산일자 + 형명별 유효기간(년) − 1일 / 년월: 생산 월 + 유효기간(년) − 1개월 (2026-10, 5년 → 2031-09)
//   수주번호·MO번호는 배포 참고용, 국가 = 거래처 국가(BASE-06), 영업 담당자 = 수주 등록자(고칠 수 있음), 배포자 = 발행한 사람
// 한 줄 = MO × 대표품목(라벨일정과 같은 단위). 발행하면 그 MO의 라벨일정(PROC-06) 출하LOT·생산일자를 이 값으로 바꾼다
// (라벨 쪽이 다시 적지 않게, Packing List의 LOT도 라벨일정 출하LOT을 쓴다).

export type DateFmt = "ym" | "ymd";
export const DATE_FMTS: { key: DateFmt; label: string }[] = [
  { key: "ymd", label: "제조년월일" },
  { key: "ym", label: "제조년월" },
];

export interface ShipLotRow {
  mo_no: string;
  rep_item: string;
  lot_no: string;
  so_no: string;
  customer: string;
  country: string;
  sales_manager: string;
  model_name: string;
  shelf_years: number | null;
  prod_date: string;
  date_fmt: DateFmt;
  /** 표기용 생산일자(년월 또는 년월일) */
  prod_text: string;
  expiry_text: string;
  issued_by: string;
  issued_at: string;
}

export interface DateRule {
  country: string;
  /** 빈 값 = 그 나라의 모든 형명 */
  model_name: string;
  date_fmt: DateFmt;
}

const ensured = new WeakSet<DatabaseSync>();

export function ensureShipLotTables(db: DatabaseSync): void {
  ensureModelNameTables(db);
  ensureLabelScheduleTables(db);
  if (ensured.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ship_lots (
      mo_no TEXT NOT NULL,
      rep_item TEXT NOT NULL,
      lot_no TEXT NOT NULL,
      so_no TEXT NOT NULL DEFAULT '',
      customer TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      sales_manager TEXT NOT NULL DEFAULT '',
      model_name TEXT NOT NULL DEFAULT '',
      prod_date TEXT NOT NULL,
      date_fmt TEXT NOT NULL DEFAULT 'ymd',
      issued_by TEXT,
      issued_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      -- 처음 발행할 때 라벨일정에 적혀 있던 값(발행 취소하면 되돌린다)
      prev_ship_lot TEXT NOT NULL DEFAULT '',
      prev_prod_date TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (mo_no, rep_item)
    );
    CREATE INDEX IF NOT EXISTS ship_lots_lot ON ship_lots (lot_no);
    CREATE TABLE IF NOT EXISTS ship_lot_date_rules (
      country TEXT NOT NULL,
      model_name TEXT NOT NULL DEFAULT '',
      date_fmt TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (country, model_name)
    );
  `);
  ensured.add(db);
}

const MONTH_CODE = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C"];

/** 생산일자(YYYY-MM-DD) → 출하LOT 앞 두 자리(연도 끝자리 + 월코드), 예) 2026-10-19 → 6A */
export function lotPrefix(prodDate: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(prodDate);
  if (!m) return "";
  return `${Number(m[1]) % 10}${MONTH_CODE[Number(m[2]) - 1] ?? ""}`;
}

export function prodText(prodDate: string, fmt: DateFmt): string {
  return fmt === "ym" ? prodDate.slice(0, 7) : prodDate;
}

export function expiryText(prodDate: string, years: number | null, fmt: DateFmt): string {
  if (fmt === "ymd") return expiryDate(prodDate, years);
  const m = /^(\d{4})-(\d{2})/.exec(prodDate);
  if (!m || !years) return "";
  const idx = Number(m[1]) * 12 + Number(m[2]) - 1 + years * 12 - 1; // 생산 월 + 유효기간 − 1개월
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** 그 달(접두어)에 이미 쓴 출하LOT과 다음 차수 — 발행 목록과 라벨일정(예전에 손으로 적은 값) 둘 다 본다 */
export function monthLots(db: DatabaseSync, prefix: string): { lots: { lot_no: string; mos: string }[]; next: string } {
  ensureShipLotTables(db);
  if (!prefix) return { lots: [], next: "" };
  const lots = db
    .prepare(
      `SELECT lot_no, group_concat(DISTINCT mo_no) mos FROM (
         SELECT lot_no, mo_no FROM ship_lots WHERE lot_no LIKE ? || '%'
         UNION SELECT ship_lot, mo_no FROM label_schedule WHERE ship_lot LIKE ? || '%'
       ) GROUP BY lot_no ORDER BY length(lot_no), lot_no`
    )
    .all(prefix, prefix) as { lot_no: string; mos: string }[];
  const seqs = lots.map((l) => Number(l.lot_no.slice(prefix.length))).filter((n) => Number.isInteger(n) && n > 0);
  return { lots, next: `${prefix}${(seqs.length ? Math.max(...seqs) : 0) + 1}` };
}

const MO_SQL = `TRIM(json_extract(detail, '$."MO-번호"'), ' ' || char(9) || char(10) || char(13))`;
const SO_SQL = `COALESCE(NULLIF(json_extract(detail, '$."수주번호"'), ''), so_no)`;

function ruleFmt(rules: DateRule[], country: string, modelName: string): DateFmt {
  const c = country.trim().toUpperCase();
  const hit =
    rules.find((r) => r.country.toUpperCase() === c && r.model_name === modelName) ??
    rules.find((r) => r.country.toUpperCase() === c && r.model_name === "");
  return hit?.date_fmt ?? "ymd";
}

/** 발행 창 — MO의 대표품목(형명·유효기간·규칙 표기)과 기본값(국가·영업 담당자·이미 발행한 값) */
export function getShipLotMo(db: DatabaseSync, moNo: string) {
  ensureShipLotTables(db);
  const h = db
    .prepare(
      `SELECT MIN(${SO_SQL}) so_no, MIN(customer_code) customer_code, MAX(json_extract(detail, '$."등록자"')) registrant
         FROM sales_orders WHERE ${MO_SQL} = ? AND COALESCE(json_extract(detail, '$."상태"'), status) <> '중단'`
    )
    .get(moNo) as { so_no: string | null; customer_code: string | null; registrant: string | null } | undefined;
  if (!h?.so_no) return null;
  const c = db.prepare("SELECT customer_name, country FROM customers WHERE customer_code = ?").get(h.customer_code) as
    | { customer_name: string | null; country: string | null }
    | undefined;
  const items = db
    .prepare(
      `SELECT s.rep_item, json_extract(i.detail, '$.형명') model_name, mn.shelf_years,
              ls.ship_lot, ls.prod_date, sl.lot_no, sl.prod_date sl_prod, sl.date_fmt, sl.country sl_country, sl.sales_manager,
              sl.issued_by, sl.issued_at
         FROM (SELECT DISTINCT json_extract(detail, '$.대표품목') rep_item FROM sales_orders
                WHERE ${MO_SQL} = ? AND COALESCE(json_extract(detail, '$."상태"'), status) <> '중단') s
         LEFT JOIN items i ON i.item_code = s.rep_item
         LEFT JOIN model_names mn ON mn.model_name = json_extract(i.detail, '$.형명')
         LEFT JOIN label_schedule ls ON ls.mo_no = ? AND ls.rep_item = s.rep_item
         LEFT JOIN ship_lots sl ON sl.mo_no = ? AND sl.rep_item = s.rep_item
        WHERE s.rep_item IS NOT NULL
        ORDER BY s.rep_item`
    )
    .all(moNo, moNo, moNo) as Record<string, string | number | null>[];
  const rules = listDateRules(db);
  const country = String(items.find((r) => r.sl_country)?.sl_country ?? c?.country ?? "");
  const str = (v: unknown) => (v == null ? "" : String(v));
  return {
    mo_no: moNo,
    so_no: h.so_no,
    customer: c?.customer_name ?? h.customer_code ?? "",
    country,
    sales_manager: str(items.find((r) => r.sales_manager)?.sales_manager) || (h.registrant ?? ""),
    issued: items.some((r) => r.lot_no),
    items: items.map((r) => ({
      rep_item: str(r.rep_item),
      model_name: str(r.model_name),
      shelf_years: r.shelf_years == null ? null : Number(r.shelf_years),
      /** 발행했으면 발행 값, 아니면 라벨일정에 적혀 있던 값 */
      lot_no: str(r.lot_no) || str(r.ship_lot),
      prod_date: str(r.sl_prod) || str(r.prod_date),
      date_fmt: ((r.date_fmt as DateFmt) || ruleFmt(rules, country, str(r.model_name))) as DateFmt,
      rule_fmt: ruleFmt(rules, country, str(r.model_name)),
      issued_by: str(r.issued_by),
      issued_at: str(r.issued_at),
    })),
  };
}

export interface ShipLotIssue {
  mo_no: string;
  lot_no: string;
  prod_date: string;
  country: string;
  sales_manager: string;
  /** 대표품목별 표기(없으면 규칙) */
  fmts?: Record<string, DateFmt>;
}

/** 발행(다시 발행 포함) — MO의 모든 대표품목에 같은 출하LOT·생산일자, 라벨일정 출하LOT·생산일자도 바꾼다 */
export function issueShipLot(db: DatabaseSync, s: ShipLotIssue, user: string | null): void {
  ensureShipLotTables(db);
  const lot = s.lot_no.trim().toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.prod_date)) throw new Error("생산일자를 입력하세요.");
  const prefix = lotPrefix(s.prod_date);
  if (!lot.startsWith(prefix) || !/^\d+$/.test(lot.slice(prefix.length))) {
    throw new Error(`출하LOT은 생산일자 연·월(${prefix})로 시작하고 뒤에 차수 숫자가 와야 합니다(예: ${prefix}1).`);
  }
  const mo = getShipLotMo(db, s.mo_no);
  if (!mo || mo.items.length === 0) throw new Error("수주에 이 MO가 없습니다.");
  const rules = listDateRules(db);
  db.exec("BEGIN");
  try {
    const up = db.prepare(
      `INSERT INTO ship_lots (mo_no, rep_item, lot_no, so_no, customer, country, sales_manager, model_name, prod_date, date_fmt, issued_by,
                              prev_ship_lot, prev_prod_date)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
               COALESCE((SELECT ship_lot FROM label_schedule WHERE mo_no = ?1 AND rep_item = ?2), ''),
               COALESCE((SELECT prod_date FROM label_schedule WHERE mo_no = ?1 AND rep_item = ?2), ''))
       ON CONFLICT(mo_no, rep_item) DO UPDATE SET lot_no = excluded.lot_no, so_no = excluded.so_no, customer = excluded.customer,
         country = excluded.country, sales_manager = excluded.sales_manager, model_name = excluded.model_name,
         prod_date = excluded.prod_date, date_fmt = excluded.date_fmt, issued_by = excluded.issued_by,
         issued_at = datetime('now','localtime')`
    );
    const ls = db.prepare(
      `INSERT INTO label_schedule (mo_no, rep_item, ship_lot, prod_date, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(mo_no, rep_item) DO UPDATE SET ship_lot = excluded.ship_lot, prod_date = excluded.prod_date,
         updated_at = datetime('now','localtime'), updated_by = excluded.updated_by`
    );
    for (const it of mo.items) {
      const f = s.fmts?.[it.rep_item];
      const fmt: DateFmt = f === "ym" || f === "ymd" ? f : ruleFmt(rules, s.country, it.model_name);
      up.run(s.mo_no, it.rep_item, lot, mo.so_no, mo.customer, s.country.trim(), s.sales_manager.trim(), it.model_name, s.prod_date, fmt, user);
      ls.run(s.mo_no, it.rep_item, lot, s.prod_date, user ? `${user}(출하LOT)` : "출하LOT");
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** 발행 취소 — 발행 줄을 지우고, 라벨일정 값이 발행 값 그대로면 처음 발행 전 값으로 되돌린다 */
export function cancelShipLot(db: DatabaseSync, moNo: string): void {
  ensureShipLotTables(db);
  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE label_schedule
          SET ship_lot = (SELECT sl.prev_ship_lot FROM ship_lots sl WHERE sl.mo_no = label_schedule.mo_no AND sl.rep_item = label_schedule.rep_item),
              prod_date = (SELECT sl.prev_prod_date FROM ship_lots sl WHERE sl.mo_no = label_schedule.mo_no AND sl.rep_item = label_schedule.rep_item),
              updated_at = datetime('now','localtime')
        WHERE mo_no = ? AND EXISTS (SELECT 1 FROM ship_lots sl WHERE sl.mo_no = label_schedule.mo_no AND sl.rep_item = label_schedule.rep_item
                                    AND sl.lot_no = label_schedule.ship_lot AND sl.prod_date = label_schedule.prod_date)`
    ).run(moNo);
    db.prepare("DELETE FROM ship_lots WHERE mo_no = ?").run(moNo);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** 발행 목록 — month(YYYY-MM)는 생산일자 월, q는 LOT·MO·수주번호·거래처·국가·담당자 */
export function listShipLots(db: DatabaseSync, month: string, q: string): ShipLotRow[] {
  ensureShipLotTables(db);
  const kw = `%${q.trim()}%`;
  const rows = db
    .prepare(
      `SELECT sl.*, mn.shelf_years FROM ship_lots sl LEFT JOIN model_names mn ON mn.model_name = sl.model_name
        WHERE (? = '' OR substr(sl.prod_date, 1, 7) = ?)
          AND (? = '%%' OR sl.lot_no LIKE ? OR sl.mo_no LIKE ? OR sl.so_no LIKE ? OR sl.customer LIKE ? OR sl.country LIKE ? OR sl.sales_manager LIKE ?)
        ORDER BY sl.prod_date DESC, length(sl.lot_no) DESC, sl.lot_no DESC, sl.mo_no, sl.rep_item`
    )
    .all(month, month, kw, kw, kw, kw, kw, kw, kw) as Record<string, string | number | null>[];
  const str = (v: unknown) => (v == null ? "" : String(v));
  return rows.map((r) => {
    const fmt = (r.date_fmt === "ym" ? "ym" : "ymd") as DateFmt;
    const years = r.shelf_years == null ? null : Number(r.shelf_years);
    return {
      mo_no: str(r.mo_no),
      rep_item: str(r.rep_item),
      lot_no: str(r.lot_no),
      so_no: str(r.so_no),
      customer: str(r.customer),
      country: str(r.country),
      sales_manager: str(r.sales_manager),
      model_name: str(r.model_name),
      shelf_years: years,
      prod_date: str(r.prod_date),
      date_fmt: fmt,
      prod_text: prodText(str(r.prod_date), fmt),
      expiry_text: expiryText(str(r.prod_date), years, fmt),
      issued_by: str(r.issued_by),
      issued_at: str(r.issued_at),
    };
  });
}

export function listDateRules(db: DatabaseSync): DateRule[] {
  ensureShipLotTables(db);
  return db.prepare("SELECT country, model_name, date_fmt FROM ship_lot_date_rules ORDER BY country, model_name").all() as unknown as DateRule[];
}

export function setDateRule(db: DatabaseSync, r: DateRule, user: string | null): void {
  ensureShipLotTables(db);
  if (!r.country.trim()) throw new Error("국가를 고르세요.");
  if (r.date_fmt !== "ym" && r.date_fmt !== "ymd") throw new Error("표기를 고르세요.");
  db.prepare(
    `INSERT INTO ship_lot_date_rules (country, model_name, date_fmt, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(country, model_name) DO UPDATE SET date_fmt = excluded.date_fmt, updated_by = excluded.updated_by, updated_at = datetime('now','localtime')`
  ).run(r.country.trim(), r.model_name.trim(), r.date_fmt, user);
}

export function deleteDateRule(db: DatabaseSync, country: string, modelName: string): void {
  ensureShipLotTables(db);
  db.prepare("DELETE FROM ship_lot_date_rules WHERE country = ? AND model_name = ?").run(country, modelName);
}

/** 규칙 창의 고를 거리 — 거래처 국가와 형명 */
export function ruleChoices(db: DatabaseSync): { countries: string[]; models: string[] } {
  ensureShipLotTables(db);
  const countries = (db.prepare("SELECT DISTINCT TRIM(country) c FROM customers WHERE TRIM(COALESCE(country, '')) <> '' ORDER BY c").all() as { c: string }[]).map((r) => r.c);
  const models = (db.prepare("SELECT model_name m FROM model_names WHERE COALESCE(use_yn, 'Y') = 'Y' ORDER BY model_name").all() as { m: string }[]).map((r) => r.m);
  return { countries, models };
}

export interface ShipLotGridRow {
  rank: number;
  done: boolean;
  so_no: string;
  mo_no: string;
  customer: string;
  brand: string;
  order_qty: number;
  due_date: string;
  issued: boolean;
  /** 발행 값, 미발행이면 라벨일정에 적혀 있던 값(label_lot) */
  lot_no: string;
  label_lot: string;
  prod_text: string;
  expiry_text: string;
  country: string;
  sales_manager: string;
  issued_by: string;
  issued_at: string;
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].join(" / ");

/** 출하LOT 탭 그리드 — PLAN-04 납기별수주현황의 수주 줄(순위·완료 포함)에 MO별 출하LOT 발행 값을 붙인다.
 *  MO에 대표품목이 여럿이면 형명마다 사용기한이 다를 수 있어 서로 다른 값은 " / "로 잇는다. */
export function shipLotGrid(db: DatabaseSync): ShipLotGridRow[] {
  ensureShipLotTables(db);
  const lots = new Map<string, ShipLotRow[]>();
  for (const r of listShipLots(db, "", "")) lots.set(r.mo_no, [...(lots.get(r.mo_no) ?? []), r]);
  // 미발행 MO의 기본 국가(거래처)·영업 담당자(수주 등록자)·라벨일정 출하LOT
  const base = new Map(
    (
      db
        .prepare(
          `SELECT ${MO_SQL} mo, MAX(c.country) country, MAX(json_extract(s.detail, '$."등록자"')) registrant,
                  (SELECT group_concat(DISTINCT ls.ship_lot) FROM label_schedule ls WHERE ls.mo_no = ${MO_SQL} AND ls.ship_lot <> '') label_lot
             FROM sales_orders s LEFT JOIN customers c ON c.customer_code = s.customer_code
            WHERE ${MO_SQL} IS NOT NULL AND ${MO_SQL} <> '' GROUP BY mo`
        )
        .all() as { mo: string; country: string | null; registrant: string | null; label_lot: string | null }[]
    ).map((r) => [r.mo, r])
  );
  return fetchDueOrders(db).rows.map((r) => {
    const mo = (r.mo_no ?? "").trim();
    const ls = lots.get(mo) ?? [];
    const b = base.get(mo);
    return {
      rank: r.rank,
      done: !!r.done,
      so_no: r.so_no,
      mo_no: mo,
      customer: r.customer ?? "",
      brand: r.brand ?? "",
      order_qty: r.order_qty,
      due_date: (r.due_date ?? "").slice(0, 10),
      issued: ls.length > 0,
      lot_no: uniq(ls.map((x) => x.lot_no)),
      label_lot: b?.label_lot ?? "",
      prod_text: uniq(ls.map((x) => x.prod_text)),
      expiry_text: uniq(ls.map((x) => x.expiry_text)),
      country: ls[0]?.country || (b?.country ?? ""),
      sales_manager: ls[0]?.sales_manager || (b?.registrant ?? ""),
      issued_by: ls[0]?.issued_by ?? "",
      issued_at: (ls[0]?.issued_at ?? "").slice(0, 16),
    };
  });
}

/** 그리드 거르기 — 화면과 엑셀이 같이 쓴다 */
export function filterShipLotGrid(rows: ShipLotGridRow[], f: { q?: string; unissued?: boolean; hideDone?: boolean }): ShipLotGridRow[] {
  const kw = (f.q ?? "").trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!f.hideDone || !r.done) &&
      (!f.unissued || !r.issued) &&
      (!kw || [r.so_no, r.mo_no, r.customer, r.brand, r.lot_no, r.label_lot, r.country, r.sales_manager, r.issued_by].some((v) => v.toLowerCase().includes(kw)))
  );
}
