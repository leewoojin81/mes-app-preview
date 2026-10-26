import type { DatabaseSync } from "node:sqlite";
import { expiryDate } from "@/lib/label-schedule-shared";
import { ensureLabelScheduleTables } from "@/lib/label-schedule";
import { ensureModelNameTables } from "@/lib/model-names";
import { fetchDueOrders } from "@/lib/due-orders";

// 영업관리 Packing List(SALES-04) "출하LOT" 탭 — 2026-10-25 사용자 요청.
// 영업이 출하LOT 번호를 정해 배포하면 라벨 쪽이 엑셀에 옮겨 적고 라벨·마킹에 인쇄하던 일을 MES에서 한다.
//   출하LOT = 연도 끝자리 + 월코드(1~9, A=10월, B=11월, C=12월) + 출하차수(그 달 1, 2, …)   예) 6A1 = 2026년 10월 1차
//            월은 생산일자의 연·월. 같은 달 다른 수주와 같은 LOT로 묶을 수도 있다(같이 출하).
//   생산일자 표기 = 국가별·형명별 규칙(ship_lot_date_rules)에 따라 제조년월(2026-10) 또는 제조년월일(2026-10-19), 규칙 없으면 년월일
//   사용기한   = 년월일: 생산일자 + 형명별 유효기간(년) − 1일 / 년월: 생산 월 + 유효기간(년) − 1개월 (2026-10, 5년 → 2031-09)
//   국가 = 그 수주 거래처 국가(BASE-06), 영업 담당자 = 수주 등록자(고칠 수 있음), 배포자 = 발행한 사람
// 2026-10-26부터 기준은 수주번호(SO) — 한 MO가 여러 수주에 걸리거나(다른 거래처 수주에 MO가 잘못 적힌 경우도) 한 수주에 MO가
// 여럿인 경우가 흔해서, MO 기준이면 다른 거래처 국가·LOT이 섞였다(사용자 요청 "앞으로 기준은 MO번호가 아닌 SO번호로").
// 한 줄 = 수주 × 대표품목. 발행하면 그 수주 줄에 적힌 MO들의 라벨일정(PROC-06, MO × 대표품목) 출하LOT·생산일자를 이 값으로 바꾼다
// (라벨 쪽이 다시 적지 않게, Packing List의 LOT도 라벨일정 출하LOT을 쓴다). 바꾸기 전 라벨일정 값은 ship_lot_links에 남겨 취소 때 되돌린다.

export type DateFmt = "ym" | "ymd";
export const DATE_FMTS: { key: DateFmt; label: string }[] = [
  { key: "ymd", label: "제조년월일" },
  { key: "ym", label: "제조년월" },
];

export interface ShipLotRow {
  so_no: string;
  rep_item: string;
  /** 그 수주 × 대표품목 줄에 적힌 MO(여럿이면 쉼표) */
  mo_nos: string;
  lot_no: string;
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
  migrateMoKeyed(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ship_lots (
      so_no TEXT NOT NULL,
      rep_item TEXT NOT NULL,
      mo_nos TEXT NOT NULL DEFAULT '',
      lot_no TEXT NOT NULL,
      customer TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      sales_manager TEXT NOT NULL DEFAULT '',
      model_name TEXT NOT NULL DEFAULT '',
      prod_date TEXT NOT NULL,
      date_fmt TEXT NOT NULL DEFAULT 'ymd',
      issued_by TEXT,
      issued_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (so_no, rep_item)
    );
    CREATE INDEX IF NOT EXISTS ship_lots_lot ON ship_lots (lot_no);
    -- 발행이 바꾼 라벨일정 줄(MO × 대표품목)과, 처음 발행할 때 거기 적혀 있던 값(발행 취소하면 되돌린다)
    CREATE TABLE IF NOT EXISTS ship_lot_links (
      so_no TEXT NOT NULL,
      rep_item TEXT NOT NULL,
      mo_no TEXT NOT NULL,
      prev_ship_lot TEXT NOT NULL DEFAULT '',
      prev_prod_date TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (so_no, rep_item, mo_no)
    );
    CREATE INDEX IF NOT EXISTS ship_lot_links_mo ON ship_lot_links (mo_no, rep_item);
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

/** 2026-10-26 이전(MO × 대표품목 기준) 표 → 수주 기준. 예전 표는 ship_lots_by_mo로 이름만 바꿔 남긴다 */
function migrateMoKeyed(db: DatabaseSync) {
  const cols = db.prepare("PRAGMA table_info(ship_lots)").all() as { name: string; pk: number }[];
  if (!cols.some((c) => c.name === "mo_no" && c.pk > 0)) return;
  db.exec("BEGIN");
  try {
    db.exec(`
      DROP INDEX IF EXISTS ship_lots_lot;
      ALTER TABLE ship_lots RENAME TO ship_lots_by_mo;
      CREATE TABLE ship_lots (
        so_no TEXT NOT NULL,
        rep_item TEXT NOT NULL,
        mo_nos TEXT NOT NULL DEFAULT '',
        lot_no TEXT NOT NULL,
        customer TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT '',
        sales_manager TEXT NOT NULL DEFAULT '',
        model_name TEXT NOT NULL DEFAULT '',
        prod_date TEXT NOT NULL,
        date_fmt TEXT NOT NULL DEFAULT 'ymd',
        issued_by TEXT,
        issued_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        PRIMARY KEY (so_no, rep_item)
      );
      CREATE TABLE IF NOT EXISTS ship_lot_links (
        so_no TEXT NOT NULL,
        rep_item TEXT NOT NULL,
        mo_no TEXT NOT NULL,
        prev_ship_lot TEXT NOT NULL DEFAULT '',
        prev_prod_date TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (so_no, rep_item, mo_no)
      );
      INSERT OR IGNORE INTO ship_lots (so_no, rep_item, mo_nos, lot_no, customer, country, sales_manager, model_name, prod_date, date_fmt, issued_by, issued_at)
        SELECT so_no, rep_item, group_concat(mo_no), MAX(lot_no), MAX(customer), MAX(country), MAX(sales_manager), MAX(model_name), MAX(prod_date),
               MAX(date_fmt), MAX(issued_by), MAX(issued_at)
          FROM ship_lots_by_mo WHERE so_no <> '' GROUP BY so_no, rep_item;
      INSERT OR IGNORE INTO ship_lot_links (so_no, rep_item, mo_no, prev_ship_lot, prev_prod_date)
        SELECT so_no, rep_item, mo_no, prev_ship_lot, prev_prod_date FROM ship_lots_by_mo WHERE so_no <> '';
    `);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
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

/**
 * 그 달(접두어)에 이미 쓴 출하LOT과 다음 차수 — 발행 목록(수주)과 라벨일정(예전에 손으로 적은 값) 둘 다 본다.
 * sos = 그 LOT으로 발행한 수주(비었으면 라벨일정에만 적혀 있는 LOT)
 */
export function monthLots(db: DatabaseSync, prefix: string): { lots: { lot_no: string; sos: string }[]; next: string } {
  ensureShipLotTables(db);
  if (!prefix) return { lots: [], next: "" };
  const lots = db
    .prepare(
      `SELECT lot_no, COALESCE(group_concat(DISTINCT so_no), '') sos FROM (
         SELECT lot_no, so_no FROM ship_lots WHERE lot_no LIKE ? || '%'
         UNION SELECT ship_lot, NULL FROM label_schedule WHERE ship_lot LIKE ? || '%'
       ) GROUP BY lot_no ORDER BY length(lot_no), lot_no`
    )
    .all(prefix, prefix) as { lot_no: string; sos: string }[];
  const seqs = lots.map((l) => Number(l.lot_no.slice(prefix.length))).filter((n) => Number.isInteger(n) && n > 0);
  return { lots, next: `${prefix}${(seqs.length ? Math.max(...seqs) : 0) + 1}` };
}

const MO_SQL = `TRIM(json_extract(detail, '$."MO-번호"'), ' ' || char(9) || char(10) || char(13))`;
const SO_SQL = `COALESCE(NULLIF(json_extract(detail, '$."수주번호"'), ''), so_no)`;
const ALIVE_SQL = `COALESCE(json_extract(detail, '$."상태"'), status) <> '중단'`;

function ruleFmt(rules: DateRule[], country: string, modelName: string): DateFmt {
  const c = country.trim().toUpperCase();
  const hit =
    rules.find((r) => r.country.toUpperCase() === c && r.model_name === modelName) ??
    rules.find((r) => r.country.toUpperCase() === c && r.model_name === "");
  return hit?.date_fmt ?? "ymd";
}

const splitMos = (s: string | null | undefined) => [...new Set((s ?? "").split(",").map((x) => x.trim()).filter(Boolean))];

/** 발행 창 — 수주의 대표품목(형명·유효기간·규칙 표기·그 줄의 MO)과 기본값(국가·영업 담당자·이미 발행한 값) */
export function getShipLotSo(db: DatabaseSync, soNo: string) {
  ensureShipLotTables(db);
  const h = db
    .prepare(`SELECT MIN(customer_code) customer_code, MAX(json_extract(detail, '$."등록자"')) registrant, COUNT(*) n FROM sales_orders WHERE ${SO_SQL} = ? AND ${ALIVE_SQL}`)
    .get(soNo) as { customer_code: string | null; registrant: string | null; n: number } | undefined;
  if (!h?.n) return null;
  const c = db.prepare("SELECT customer_name, country FROM customers WHERE customer_code = ?").get(h.customer_code) as
    | { customer_name: string | null; country: string | null }
    | undefined;
  const items = db
    .prepare(
      `SELECT s.rep_item, s.mos, json_extract(i.detail, '$.형명') model_name, mn.shelf_years,
              sl.lot_no, sl.prod_date sl_prod, sl.date_fmt, sl.country sl_country, sl.sales_manager, sl.issued_by, sl.issued_at
         FROM (SELECT json_extract(detail, '$.대표품목') rep_item, group_concat(DISTINCT NULLIF(${MO_SQL}, '')) mos FROM sales_orders
                WHERE ${SO_SQL} = ? AND ${ALIVE_SQL} GROUP BY 1) s
         LEFT JOIN items i ON i.item_code = s.rep_item
         LEFT JOIN model_names mn ON mn.model_name = json_extract(i.detail, '$.형명')
         LEFT JOIN ship_lots sl ON sl.so_no = ? AND sl.rep_item = s.rep_item
        WHERE s.rep_item IS NOT NULL
        ORDER BY s.rep_item`
    )
    .all(soNo, soNo) as Record<string, string | number | null>[];
  // 미발행이면 라벨일정(그 줄 MO들)에 적혀 있던 출하LOT·생산일자를 기본값으로
  const label = db.prepare("SELECT ship_lot, prod_date FROM label_schedule WHERE mo_no = ? AND rep_item = ?");
  const rules = listDateRules(db);
  const country = String(items.find((r) => r.sl_country)?.sl_country ?? c?.country ?? "");
  const str = (v: unknown) => (v == null ? "" : String(v));
  const mapped = items.map((r) => {
    const mos = splitMos(str(r.mos));
    const ls = mos.map((mo) => label.get(mo, str(r.rep_item)) as { ship_lot: string | null; prod_date: string | null } | undefined).filter(Boolean);
    return {
      rep_item: str(r.rep_item),
      mos,
      model_name: str(r.model_name),
      shelf_years: r.shelf_years == null ? null : Number(r.shelf_years),
      /** 발행했으면 발행 값, 아니면 라벨일정에 적혀 있던 값 */
      lot_no: str(r.lot_no) || str(ls.find((x) => x?.ship_lot)?.ship_lot),
      prod_date: str(r.sl_prod) || str(ls.find((x) => x?.prod_date)?.prod_date),
      date_fmt: ((r.date_fmt as DateFmt) || ruleFmt(rules, country, str(r.model_name))) as DateFmt,
      rule_fmt: ruleFmt(rules, country, str(r.model_name)),
      issued: !!r.lot_no,
      issued_by: str(r.issued_by),
      issued_at: str(r.issued_at),
    };
  });
  return {
    so_no: soNo,
    mo_nos: [...new Set(mapped.flatMap((i) => i.mos))],
    customer: c?.customer_name ?? h.customer_code ?? "",
    country,
    sales_manager: str(items.find((r) => r.sales_manager)?.sales_manager) || (h.registrant ?? ""),
    issued: mapped.some((i) => i.issued),
    items: mapped,
  };
}

export interface ShipLotIssue {
  so_no: string;
  lot_no: string;
  prod_date: string;
  country: string;
  sales_manager: string;
  /** 대표품목별 표기(없으면 규칙) */
  fmts?: Record<string, DateFmt>;
}

/** 발행(다시 발행 포함) — 수주의 모든 대표품목에 같은 출하LOT·생산일자, 그 줄 MO들의 라벨일정 출하LOT·생산일자도 바꾼다 */
export function issueShipLot(db: DatabaseSync, s: ShipLotIssue, user: string | null): void {
  ensureShipLotTables(db);
  db.exec("BEGIN");
  try {
    writeShipLot(db, s, user);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export interface ShipLotBulkIssue {
  so_nos: string[];
  prod_date: string;
  /** same: 모두 lot_no 하나(같이 출하) / each: 수주마다 그 달 새 차수(고른 순서대로) */
  mode: "same" | "each";
  lot_no?: string;
  /** 이미 발행한 수주도 다시 발행(기본은 건너뜀) */
  reissue?: boolean;
  /** 수주별로 고친 출하LOT·국가·영업담당자·대표품목별 표기(없으면 그 수주 기본값, 출하LOT은 mode대로) */
  per?: Record<string, { lot_no?: string; country?: string; sales_manager?: string; fmts?: Record<string, DateFmt> }>;
}

const perLot = (b: ShipLotBulkIssue, so: string) => {
  const v = b.per?.[so]?.lot_no;
  return typeof v === "string" ? v.trim() : "";
};

/**
 * 여러 수주 한 번에 발행(2026-10-26) — 생산일자는 하나, 국가·영업담당자·생산일자 표기는 per로 수주별로 고칠 수 있고 없으면 그 수주 기본값.
 * 한 트랜잭션이라 하나라도 틀리면 모두 되돌린다. 돌려주는 값은 수주별 결과(건너뛴 수주 포함).
 */
export function issueShipLots(db: DatabaseSync, b: ShipLotBulkIssue, user: string | null): { so_no: string; lot_no: string; skipped: boolean }[] {
  ensureShipLotTables(db);
  const sos = [...new Set(b.so_nos.map((m) => m.trim()).filter(Boolean))];
  if (sos.length === 0) throw new Error("발행할 수주를 고르세요.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.prod_date)) throw new Error("생산일자를 입력하세요.");
  const prefix = lotPrefix(b.prod_date);
  if (b.mode === "same" && !b.lot_no?.trim() && !sos.every((so) => perLot(b, so))) throw new Error("출하LOT을 고르세요.");
  let seq = Number(monthLots(db, prefix).next.slice(prefix.length));
  const out: { so_no: string; lot_no: string; skipped: boolean }[] = [];
  db.exec("BEGIN");
  try {
    for (const soNo of sos) {
      const so = getShipLotSo(db, soNo);
      if (!so || so.items.length === 0) throw new Error(`수주 ${soNo}에 대표품목이 없습니다.`);
      if (so.issued && !b.reissue) {
        out.push({ so_no: soNo, lot_no: so.items[0]?.lot_no ?? "", skipped: true });
        continue;
      }
      const p = b.per?.[soNo];
      // 수주별 출하LOT(2026-10-26 — 같은 창에서 수주마다 다른 LOT) > 공통 LOT > 수주마다 새 차수
      const lot = perLot(b, soNo) ? perLot(b, soNo).toUpperCase() : b.mode === "same" ? b.lot_no!.trim().toUpperCase() : `${prefix}${seq++}`;
      writeShipLot(
        db,
        {
          so_no: soNo, lot_no: lot, prod_date: b.prod_date, country: p?.country ?? so.country, sales_manager: p?.sales_manager ?? so.sales_manager,
          fmts: { ...Object.fromEntries(so.items.map((i) => [i.rep_item, i.date_fmt])), ...p?.fmts },
        },
        user
      );
      out.push({ so_no: soNo, lot_no: lot, skipped: false });
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return out;
}

/** 발행 한 건 쓰기(트랜잭션은 부르는 쪽) */
function writeShipLot(db: DatabaseSync, s: ShipLotIssue, user: string | null): void {
  const lot = s.lot_no.trim().toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.prod_date)) throw new Error("생산일자를 입력하세요.");
  const prefix = lotPrefix(s.prod_date);
  if (!lot.startsWith(prefix) || !/^\d+$/.test(lot.slice(prefix.length))) {
    throw new Error(`출하LOT은 생산일자 연·월(${prefix})로 시작하고 뒤에 차수 숫자가 와야 합니다(예: ${prefix}1).`);
  }
  const so = getShipLotSo(db, s.so_no);
  if (!so || so.items.length === 0) throw new Error("이 수주에 대표품목이 없습니다.");
  const rules = listDateRules(db);
  const up = db.prepare(
    `INSERT INTO ship_lots (so_no, rep_item, mo_nos, lot_no, customer, country, sales_manager, model_name, prod_date, date_fmt, issued_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(so_no, rep_item) DO UPDATE SET mo_nos = excluded.mo_nos, lot_no = excluded.lot_no, customer = excluded.customer,
       country = excluded.country, sales_manager = excluded.sales_manager, model_name = excluded.model_name,
       prod_date = excluded.prod_date, date_fmt = excluded.date_fmt, issued_by = excluded.issued_by,
       issued_at = datetime('now','localtime')`
  );
  // 처음 바꿀 때만 그때 라벨일정 값을 남긴다(다시 발행해도 처음 값 유지)
  const link = db.prepare(
    `INSERT OR IGNORE INTO ship_lot_links (so_no, rep_item, mo_no, prev_ship_lot, prev_prod_date)
     VALUES (?1, ?2, ?3, COALESCE((SELECT ship_lot FROM label_schedule WHERE mo_no = ?3 AND rep_item = ?2), ''),
                         COALESCE((SELECT prod_date FROM label_schedule WHERE mo_no = ?3 AND rep_item = ?2), ''))`
  );
  const ls = db.prepare(
    `INSERT INTO label_schedule (mo_no, rep_item, ship_lot, prod_date, updated_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(mo_no, rep_item) DO UPDATE SET ship_lot = excluded.ship_lot, prod_date = excluded.prod_date,
       updated_at = datetime('now','localtime'), updated_by = excluded.updated_by`
  );
  for (const it of so.items) {
    const f = s.fmts?.[it.rep_item];
    const fmt: DateFmt = f === "ym" || f === "ymd" ? f : ruleFmt(rules, s.country, it.model_name);
    up.run(s.so_no, it.rep_item, it.mos.join(","), lot, so.customer, s.country.trim(), s.sales_manager.trim(), it.model_name, s.prod_date, fmt, user);
    for (const mo of it.mos) {
      link.run(s.so_no, it.rep_item, mo);
      ls.run(mo, it.rep_item, lot, s.prod_date, user ? `${user}(출하LOT)` : "출하LOT");
    }
  }
}

/** 발행 취소 — 발행 줄을 지우고, 라벨일정 값이 이 수주가 발행한 값 그대로면 처음 발행 전 값으로 되돌린다 */
export function cancelShipLot(db: DatabaseSync, soNo: string): void {
  ensureShipLotTables(db);
  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE label_schedule
          SET ship_lot = (SELECT k.prev_ship_lot FROM ship_lot_links k WHERE k.so_no = ?1 AND k.mo_no = label_schedule.mo_no AND k.rep_item = label_schedule.rep_item),
              prod_date = (SELECT k.prev_prod_date FROM ship_lot_links k WHERE k.so_no = ?1 AND k.mo_no = label_schedule.mo_no AND k.rep_item = label_schedule.rep_item),
              updated_at = datetime('now','localtime')
        WHERE EXISTS (SELECT 1 FROM ship_lot_links k JOIN ship_lots sl ON sl.so_no = k.so_no AND sl.rep_item = k.rep_item
                       WHERE k.so_no = ?1 AND k.mo_no = label_schedule.mo_no AND k.rep_item = label_schedule.rep_item
                         AND sl.lot_no = label_schedule.ship_lot AND sl.prod_date = label_schedule.prod_date)`
    ).run(soNo);
    db.prepare("DELETE FROM ship_lot_links WHERE so_no = ?").run(soNo);
    db.prepare("DELETE FROM ship_lots WHERE so_no = ?").run(soNo);
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
          AND (? = '%%' OR sl.lot_no LIKE ? OR sl.mo_nos LIKE ? OR sl.so_no LIKE ? OR sl.customer LIKE ? OR sl.country LIKE ? OR sl.sales_manager LIKE ?)
        ORDER BY sl.prod_date DESC, length(sl.lot_no) DESC, sl.lot_no DESC, sl.so_no, sl.rep_item`
    )
    .all(month, month, kw, kw, kw, kw, kw, kw, kw) as Record<string, string | number | null>[];
  const str = (v: unknown) => (v == null ? "" : String(v));
  return rows.map((r) => {
    const fmt = (r.date_fmt === "ym" ? "ym" : "ymd") as DateFmt;
    const years = r.shelf_years == null ? null : Number(r.shelf_years);
    return {
      so_no: str(r.so_no),
      rep_item: str(r.rep_item),
      mo_nos: str(r.mo_nos),
      lot_no: str(r.lot_no),
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
  /** 그 수주 줄에 적힌 MO(여럿이면 ", ") */
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

/** 출하LOT 탭 그리드 — PLAN-04 납기별수주현황의 수주 줄(순위·완료 포함)에 수주별 출하LOT 발행 값을 붙인다.
 *  수주에 대표품목이 여럿이면 형명마다 사용기한이 다를 수 있어 서로 다른 값은 " / "로 잇는다. */
export function shipLotGrid(db: DatabaseSync): ShipLotGridRow[] {
  ensureShipLotTables(db);
  const lots = new Map<string, ShipLotRow[]>();
  for (const r of listShipLots(db, "", "")) lots.set(r.so_no, [...(lots.get(r.so_no) ?? []), r]);
  // 미발행 수주의 기본 국가(그 수주 거래처)·영업 담당자(수주 등록자)·그 줄 MO와 라벨일정 출하LOT
  const labelLot = new Map(
    (db.prepare("SELECT mo_no, rep_item, ship_lot FROM label_schedule WHERE ship_lot <> ''").all() as { mo_no: string; rep_item: string; ship_lot: string }[]).map((r) => [
      `${r.mo_no}|${r.rep_item}`,
      r.ship_lot,
    ])
  );
  const base = new Map<string, { country: string; registrant: string; mos: string[]; label: string[] }>();
  for (const r of db
    .prepare(
      `SELECT ${SO_SQL} so, ${MO_SQL} mo, json_extract(s.detail, '$.대표품목') rep, MAX(c.country) country, MAX(json_extract(s.detail, '$."등록자"')) registrant
         FROM sales_orders s LEFT JOIN customers c ON c.customer_code = s.customer_code
        WHERE ${ALIVE_SQL} GROUP BY 1, 2, 3`
    )
    .all() as { so: string; mo: string | null; rep: string | null; country: string | null; registrant: string | null }[]) {
    const b = base.get(r.so) ?? { country: "", registrant: "", mos: [], label: [] };
    b.country ||= r.country ?? "";
    b.registrant ||= r.registrant ?? "";
    if (r.mo && !b.mos.includes(r.mo)) b.mos.push(r.mo);
    const l = r.mo && r.rep ? labelLot.get(`${r.mo}|${r.rep}`) : undefined;
    if (l && !b.label.includes(l)) b.label.push(l);
    base.set(r.so, b);
  }
  return fetchDueOrders(db).rows.map((r) => {
    const ls = lots.get(r.so_no) ?? [];
    const b = base.get(r.so_no);
    return {
      rank: r.rank,
      done: !!r.done,
      so_no: r.so_no,
      mo_no: b?.mos.length ? b.mos.join(", ") : (r.mo_no ?? "").trim(),
      customer: r.customer ?? "",
      brand: r.brand ?? "",
      order_qty: r.order_qty,
      due_date: (r.due_date ?? "").slice(0, 10),
      issued: ls.length > 0,
      lot_no: uniq(ls.map((x) => x.lot_no)),
      label_lot: b?.label.join(",") ?? "",
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
