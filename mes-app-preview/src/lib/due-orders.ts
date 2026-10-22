import type { DatabaseSync } from "node:sqlite";

// 생산계획 "납기별수주현황(PLAN-04)" — 생산계획 엑셀(2026년_10월_생산계획ERP)의 「납기별」 시트와
// 수주별 시트(세원A21, 스타비젼A303 …)를 MES 데이터만으로 다시 계산한 것. 수주마다 시트를 만들고 지우던
// 방식 대신, 진행 중인 수주를 한 목록으로 보고 수주를 누르면 품목(모델)별 → 도수별 상세를 본다.
//
// 데이터 출처(모두 매일 자동 업로드되는 ERP 스냅샷/누적 테이블)
//  - 주문량·납기·고객·브랜드: 수주등록(SALES-02, sales_orders) — 상태 '중단' 줄은 제외
//  - 공정재공(조립~출하포장 11개 공정): 공정재공현황(INV-03, process_wip_status) 품목코드별 합계
//  - 기초재고: 현재고현황(INV-02, inventory_status)의 제품창고A + 조립창고 재고
//  - 출고: 제품출고등록(SALES-03, product_shipment_status) 수주번호·품목코드별 출고수량
//
// 엑셀 수주별 시트의 계산식을 그대로 옮겼다(2026-10-22 엑셀 3,000여 행과 대조해 확인).
//  - 누적주문(L) = 이 수주 주문량 + 같은 품목의 앞 순위 수주 주문량, 누적출고(Y)도 같은 방식
//    (엑셀은 같은 고객의 앞 시트만 더했지만 MES는 순위가 앞선 모든 진행 수주를 더한다 — 품목코드가 고객별이라 결과는 같다)
//  - 공정 k 부족분 = 누적주문 − 기초재고 − 누적출고 − (k 다음 공정 ~ 출하포장 재공 합), 0 이하이면 "완료"
//    (분리3 부족분은 습윤~출하포장, 검사 부족분은 이재기~출하포장, 완검 부족분은 출하포장, 출하 부족분은 재공 없이 계산)
//  - 조립투입 = 검사부족분 ÷ 직진율 − 조립 − 분리3 − 습윤 − 외관검사×108%, 0 이하이면 0, 아니면 60 단위 올림
//  - 공정재공은 품목코드 기준이라 같은 품목을 가진 여러 수주에 똑같이 보인다(엑셀과 동일)
//  - 착색재고 = 모델(품목코드 앞 9자리 = BOM 대표코드)의 직접 구성품 중 반제품·품목군 "착색"인 품목의 조립창고 재고.
//    같은 모델의 도수 줄은 모두 같은 값이고, 수주 단위는 그 수주에 든 모델별 값의 합이다(시안 값과 대조해 확인).
// 엑셀의 조정값(Z열, 손입력)은 아직 넣지 않았다.

export const STAGES = ["조립", "분리3", "습윤", "외관검사", "이재기", "실링", "멸균", "입고대기", "중간창고", "마킹", "출하포장"] as const;
/** 부족분 이름 — SHORT_NAMES[k-1]이 공정 k(분리3=1 … 출하=10)의 부족분 */
export const SHORT_NAMES = ["분리3", "습윤", "검사", "이재기", "실링", "멸균", "입고대기", "중간창고", "완검", "출하"] as const;
/** 직진율 — 엑셀 「납기별」 AJ1 값(0.88) */
export const STRAIGHT_RATE = 0.88;
const INSPECT_FACTOR = 1.08;
const ASSY_LOT = 60;
const BASE_WAREHOUSES = ["제품창고A", "조립창고"];
const COLOR_WAREHOUSE = "조립창고";

export interface DueOrderLine {
  item_code: string;
  model: string;
  power: number | null;
  item_name: string | null;
  order_qty: number;
  cum_order: number;
  wip: number[];
  shipped: number;
  cum_shipped: number;
  base_stock: number;
  /** 모델 단위 착색재고(같은 모델의 도수 줄은 같은 값) */
  color_stock: number;
  /** 분리3~출하 부족분 10개 — null은 "완료" */
  shorts: (number | null)[];
  assy_in: number;
}

export interface DueOrderRow {
  rank: number;
  so_no: string;
  mo_no: string | null;
  customer: string | null;
  brand: string | null;
  due_date: string | null;
  pack_method: string | null;
  seq: number | null;
  line_count: number;
  order_qty: number;
  shipped: number;
  wip: number[];
  /** 수주에 든 모델별 착색재고의 합 */
  color_stock: number;
  assy_in: number;
  ship_short: number;
  ship_rate: number;
}

export interface DueOrdersResult {
  rows: DueOrderRow[];
  as_of: { sales: string | null; wip: string | null; inventory: string | null; shipment: string | null };
  straight_rate: number;
}

function soBase(soNo: string): string {
  const i = soNo.indexOf("-");
  return i > 0 ? soNo.slice(0, i) : soNo;
}

/** 품목코드 끝 4자리 → 도수(엑셀 J열: -(RIGHT(코드,4)/100)) */
export function powerOf(itemCode: string): number | null {
  const m = /-(\d{4})$/.exec(itemCode);
  if (!m) return null;
  const v = -Number(m[1]) / 100;
  return v === 0 ? 0 : v;
}

export function assyInput(inspectShort: number | null, wip: number[], rate = STRAIGHT_RATE): number {
  if (inspectShort == null) return 0;
  const v = inspectShort / rate - wip[0] - wip[1] - wip[2] - wip[3] * INSPECT_FACTOR;
  if (!(v > 0)) return 0;
  return Math.ceil(Math.round(v * 1e6) / 1e6 / ASSY_LOT) * ASSY_LOT;
}

type Computed = { at: number; result: DueOrdersResult; lines: Map<string, DueOrderLine[]> };
const cache = new WeakMap<DatabaseSync, Computed>();

function compute(db: DatabaseSync): Computed {
  // 1) 진행 중인 수주(상태가 수주/Packing인 줄이 하나라도 있는 수주번호)의 품목 줄
  const raw = db
    .prepare(
      `WITH s AS (
         SELECT so.*, COALESCE(NULLIF(json_extract(so.detail, '$."수주번호"'), ''),
                  CASE WHEN instr(so.so_no, '-') > 0 THEN substr(so.so_no, 1, instr(so.so_no, '-') - 1) ELSE so.so_no END) sono,
                COALESCE(json_extract(so.detail, '$."상태"'), so.status) st
           FROM sales_orders so
       ), act AS (
         SELECT sono FROM s
          WHERE REPLACE(COALESCE(json_extract(detail, '$."거래처명"'), ''), ' ', '') <> '(주)메디오스'
          GROUP BY sono
         HAVING SUM(CASE WHEN st IN ('수주', 'Packing') THEN 1 ELSE 0 END) > 0
       )
       SELECT s.sono, s.item_code, s.order_qty qty, s.due_date due, s.st,
              NULLIF(TRIM(json_extract(s.detail, '$."MO-번호"')), '') mo,
              COALESCE(NULLIF(TRIM(cu.short_name), ''), json_extract(s.detail, '$."거래처명"')) cname,
              json_extract(s.detail, '$."품목군"') grp,
              CAST(json_extract(s.detail, '$."작업순서"') AS INTEGER) seq,
              json_extract(it.detail, '$."포장방법"') pm,
              it.item_name
         FROM s JOIN act ON act.sono = s.sono
         LEFT JOIN customers cu ON cu.customer_code = s.customer_code
         LEFT JOIN items it ON it.item_code = s.item_code
        WHERE s.st <> '중단'`
    )
    .all() as {
    sono: string; item_code: string; qty: number | null; due: string | null; st: string;
    mo: string | null; cname: string | null; grp: string | null; seq: number | null; pm: string | null; item_name: string | null;
  }[];

  type Head = { so_no: string; mo: string | null; cname: string | null; grp: string | null; due: string | null; seq: number | null; pm: string | null; items: Map<string, { qty: number; name: string | null }> };
  const heads = new Map<string, Head>();
  for (const r of raw) {
    let h = heads.get(r.sono);
    if (!h) {
      h = { so_no: r.sono, mo: null, cname: null, grp: null, due: null, seq: null, pm: null, items: new Map() };
      heads.set(r.sono, h);
    }
    h.mo ??= r.mo;
    h.cname ??= r.cname;
    h.grp ??= r.grp;
    h.pm ??= r.pm;
    if (r.due && (!h.due || r.due < h.due)) h.due = r.due;
    if (r.seq != null && (h.seq == null || r.seq < h.seq)) h.seq = r.seq;
    const it = h.items.get(r.item_code) ?? { qty: 0, name: r.item_name };
    it.qty += r.qty ?? 0;
    h.items.set(r.item_code, it);
  }
  // 순위: 납기일 → 생산순위지정(PLAN-01) 작업순서 → 수주번호 (계획정보 납기진행 탭과 같은 기준)
  const ordered = [...heads.values()].sort((a, b) => {
    const da = a.due ?? "9999", dbb = b.due ?? "9999";
    if (da !== dbb) return da < dbb ? -1 : 1;
    const sa = a.seq ?? Number.MAX_SAFE_INTEGER, sb = b.seq ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.so_no < b.so_no ? -1 : a.so_no > b.so_no ? 1 : 0;
  });

  // 2) 품목코드별 공정재공
  const stageSql = STAGES.map((s, i) => `SUM(COALESCE(CAST(json_extract(detail, '$."${s}"') AS REAL), 0)) s${i}`).join(", ");
  const wipMap = new Map<string, number[]>();
  for (const r of db.prepare(`SELECT item_code, ${stageSql} FROM process_wip_status GROUP BY item_code`).all() as Record<string, number | string>[]) {
    wipMap.set(String(r.item_code), STAGES.map((_, i) => Number(r[`s${i}`]) || 0));
  }

  // 3) 기초재고(제품창고A + 조립창고)
  const baseMap = new Map<string, number>();
  for (const r of db
    .prepare(`SELECT item_code, SUM(COALESCE(stock_qty, 0)) q FROM inventory_status WHERE warehouse IN (${BASE_WAREHOUSES.map(() => "?").join(",")}) GROUP BY item_code`)
    .all(...BASE_WAREHOUSES) as { item_code: string; q: number }[]) {
    baseMap.set(r.item_code, r.q ?? 0);
  }

  // 3-2) 모델(BOM 대표코드)별 착색재고
  const colorMap = new Map<string, number>();
  for (const r of db
    .prepare(
      `SELECT c.parent_item_code p, SUM(COALESCE(i.stock_qty, 0)) q
         FROM (SELECT DISTINCT b.parent_item_code, b.child_item_code
                 FROM bom b JOIN items it ON it.item_code = b.child_item_code
                WHERE it.category = '반제품' AND json_extract(it.detail, '$."품목군"') = '착색') c
         JOIN inventory_status i ON i.item_code = c.child_item_code AND i.warehouse = ?
        GROUP BY c.parent_item_code`
    )
    .all(COLOR_WAREHOUSE) as { p: string; q: number }[]) {
    colorMap.set(r.p, r.q ?? 0);
  }

  // 4) 수주번호·품목별 출고
  const shipMap = new Map<string, number>();
  for (const r of db
    .prepare(`SELECT so_no, item_code, SUM(COALESCE(CAST(json_extract(detail, '$."출고수량"') AS REAL), 0)) q FROM product_shipment_status WHERE so_no IS NOT NULL GROUP BY so_no, item_code`)
    .all() as { so_no: string; item_code: string; q: number }[]) {
    const k = `${soBase(r.so_no.trim())}|${r.item_code}`;
    shipMap.set(k, (shipMap.get(k) ?? 0) + (r.q ?? 0));
  }

  // 5) 순위대로 누적주문·누적출고를 쌓으며 부족분·조립투입 계산
  const cumOrder = new Map<string, number>();
  const cumShip = new Map<string, number>();
  const lines = new Map<string, DueOrderLine[]>();
  const rows: DueOrderRow[] = ordered.map((h, idx) => {
    const ls: DueOrderLine[] = [];
    for (const [code, it] of h.items) {
      const shipped = shipMap.get(`${h.so_no}|${code}`) ?? 0;
      const L = (cumOrder.get(code) ?? 0) + it.qty;
      const Y = (cumShip.get(code) ?? 0) + shipped;
      cumOrder.set(code, L);
      cumShip.set(code, Y);
      const wip = wipMap.get(code) ?? STAGES.map(() => 0);
      const base = baseMap.get(code) ?? 0;
      const shorts: (number | null)[] = [];
      for (let k = 1; k <= 10; k++) {
        let after = 0;
        for (let j = k + 1; j <= 10; j++) after += wip[j];
        const v = L - base - Y - after;
        shorts.push(v <= 0 ? null : v);
      }
      ls.push({
        item_code: code,
        model: code.length >= 9 ? code.slice(0, 9) : code,
        power: powerOf(code),
        item_name: it.name,
        order_qty: it.qty,
        cum_order: L,
        wip,
        shipped,
        cum_shipped: Y,
        base_stock: base,
        color_stock: colorMap.get(code.length >= 9 ? code.slice(0, 9) : code) ?? 0,
        shorts,
        assy_in: assyInput(shorts[2], wip),
      });
    }
    ls.sort((a, b) => (a.model === b.model ? (b.power ?? 0) - (a.power ?? 0) : a.model < b.model ? -1 : 1));
    lines.set(h.so_no, ls);
    const ordered_ = ls.filter((l) => l.order_qty > 0);
    const order_qty = ordered_.reduce((s, l) => s + l.order_qty, 0);
    const shipped = ls.reduce((s, l) => s + l.shipped, 0);
    const ship_short = ls.reduce((s, l) => s + (l.shorts[9] ?? 0), 0);
    return {
      rank: idx + 1,
      so_no: h.so_no,
      mo_no: h.mo,
      customer: h.cname,
      brand: h.grp,
      due_date: h.due,
      pack_method: h.pm,
      seq: h.seq,
      line_count: ls.length,
      order_qty,
      shipped,
      wip: STAGES.map((_, i) => ordered_.reduce((s, l) => s + l.wip[i], 0)),
      color_stock: [...new Map(ls.map((l) => [l.model, l.color_stock])).values()].reduce((s, v) => s + v, 0),
      assy_in: ls.reduce((s, l) => s + l.assy_in, 0),
      ship_short,
      ship_rate: order_qty > 0 ? Math.min(1, Math.max(0, shipped / order_qty)) : 0,
    };
  });

  const one = (sql: string) => ((db.prepare(sql).get() as { v: string | null } | undefined)?.v ?? null);
  const result: DueOrdersResult = {
    rows,
    as_of: {
      sales: one("SELECT MAX(created_at) v FROM sales_orders"),
      wip: one("SELECT MAX(uploaded_at) v FROM process_wip_status"),
      inventory: one("SELECT MAX(uploaded_at) v FROM inventory_status"),
      shipment: one("SELECT MAX(ship_date) v FROM product_shipment_status"),
    },
    straight_rate: STRAIGHT_RATE,
  };
  return { at: Date.now(), result, lines };
}

/** 계산 결과를 30초 동안 재사용한다(목록 → 상세를 연달아 열 때 다시 계산하지 않도록) */
function load(db: DatabaseSync, fresh = false): Computed {
  const hit = cache.get(db);
  if (!fresh && hit && Date.now() - hit.at < 30_000) return hit;
  const next = compute(db);
  cache.set(db, next);
  return next;
}

export function fetchDueOrders(db: DatabaseSync, fresh = false): DueOrdersResult {
  return load(db, fresh).result;
}

export function fetchDueOrderLines(db: DatabaseSync, soNo: string): { row: DueOrderRow | null; lines: DueOrderLine[] } {
  const c = load(db);
  return { row: c.result.rows.find((r) => r.so_no === soNo) ?? null, lines: c.lines.get(soNo) ?? [] };
}
