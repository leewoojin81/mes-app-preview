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
//    LOT마다 무도수/유도수로 나눈다 — BASE 인쇄를 자동Base 호기에서만 했거나, BASE 인쇄 실적 없이 착색 인쇄를 자동인쇄 호기에서
//    했으면 무도수, 나머지(수동 Back 호기 BASE, 실적 없음)는 유도수. LOT No는 BASE 인쇄 → 착색 인쇄까지 그대로 이어진다.
//    무도수용 착색은 유도수에도 쓸 수 있지만 유도수용은 무도수로 못 쓴다 — 그래서 도수 줄은 0.00이면 무도수용,
//    -0.25 ~ -10.00이면 무도수용 + 유도수용(같은 모델의 유도수 줄은 같은 값)이고,
//    모델·수주 단위는 무도수용 + 유도수용, 수주 단위는 그 수주에 든 모델별 값의 합이다.
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
  /** 이 도수에 쓸 수 있는 착색재고 — 0.00은 무도수용만, 그 외 도수는 무도수용 + 유도수용(무도수용은 혼용 가능) */
  color_stock: number;
  /** 모델 단위 착색재고(무도수 + 유도수) */
  model_color_stock: number;
  /** 모델 단위 착색재고 중 무도수용(유도수용 = model_color_stock − 이 값) */
  model_color_mu: number;
  /** 분리3~출하 부족분 10개 — null은 "완료" */
  shorts: (number | null)[];
  assy_in: number;
  /** 품목정보(BASE-01) 사용여부 — null은 BASE-01에 없는 품목코드(상세 조회에서만 채움) */
  use_yn?: string | null;
  /** 수주에 없는 도수 — 도수변경 재공을 보려고 상세에 기본 도수표로 덧붙인 줄(주문·부족분·조립투입 없음) */
  extra?: boolean;
  /** 최근 1개월(조립일자 기준) 이 품목코드(이전도수)에서 다른 도수로 변경되어 조립된 작업지시 건수(상세 조회에서만 채움) */
  dosu_changes?: number;
  /** 모델(BOM 대표코드)의 실링지(BFS) 현재고 — 원.부자재창고·포장창고·조립창고 합, 같은 모델은 모든 도수 줄이 같은 값(상세 조회에서만 채움) */
  seal_stock?: number;
  /** 실링지 자재코드(BOM에 없으면 빈 배열) */
  seal_codes?: string[];
  /** 조립투입 표시 — 화면에서 "투입함"으로 표시한 줄(모든 사용자 공유, 상세 조회에서만 채움) */
  assy_mark?: AssyMark | null;
  /** 품목변경 가능 수량 — 검사부족이 있는 줄만, 같은 모델 다른 도수의 외관검사 이후 재공 중 도수1~3이 모두 이 도수 ±0.225인 것(상세 조회에서만 채움) */
  item_change?: number;
}

export interface AssyMark {
  /** 표시할 때의 조립투입 수량 */
  qty: number;
  marked_by: string | null;
  marked_at: string;
}

export interface DueOrderRow {
  rank: number;
  so_no: string;
  mo_no: string | null;
  customer: string | null;
  brand: string | null;
  due_date: string | null;
  pack_method: string | null;
  /** 수주등록(SALES-02) 줄 상태 — 줄마다 다르면 '수주/Packing'처럼 이어 붙인다 */
  status: string;
  seq: number | null;
  line_count: number;
  order_qty: number;
  shipped: number;
  wip: number[];
  /** 수주에 든 모델별 착색재고의 합 */
  color_stock: number;
  /** 공정 부족분 10개(분리3~출하, SHORT_NAMES 순서)의 줄별 합 — 공정별 진행률 = (주문량 − 부족분) ÷ 주문량 */
  shorts: number[];
  assy_in: number;
  ship_short: number;
  ship_rate: number;
  /** 최근 1개월 안에 출고된 완료 수주(ERP 상태 '완료') — 순위·부족분 계산에 넣지 않고 목록 맨 위에 붙인다(rank 0) */
  done?: boolean;
  /** 마지막 출고일(완료 수주만) */
  last_ship?: string | null;
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
/**
 * 무도수 착색 LOT 판정(아래 colorMap 쿼리의 LOT 실적 l 기준) — BASE를 자동호기에서만 했거나, BASE 실적 없이 착색 자동호기.
 * BASE 실적이 자동Base·Back 호기 양쪽에 있는 LOT(2026-10 기준 9개)는 처리 방법이 보류돼 우선 유도수로 둔다.
 */
const COLOR_MU = `(l.base_auto = 1 OR (l.has_base IS NULL AND l.color_auto = 1))`;

/** 도수 줄의 착색재고 — 0.00은 무도수용만, 그 외(도수 없는 품목코드 포함)는 무도수용 + 유도수용 */
function colorStockOf(
  c: { mu: number; yu: number } | undefined,
  power: number | null
): { color_stock: number; model_color_stock: number; model_color_mu: number } {
  const mu = c?.mu ?? 0;
  const yu = c?.yu ?? 0;
  return { color_stock: power === 0 ? mu : mu + yu, model_color_stock: mu + yu, model_color_mu: mu };
}

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

type Computed = { at: number; result: DueOrdersResult; lines: Map<string, DueOrderLine[]>; colors: Map<string, { mu: number; yu: number }> };
const cache = new WeakMap<DatabaseSync, Computed>();

function compute(db: DatabaseSync): Computed {
  // 1) 진행 중인 수주(상태가 수주/Packing인 줄이 하나라도 있는 수주번호)의 품목 줄
  //    fin = 줄이 모두 완료(중단 제외)인 수주 — 최근 1개월 출고분만 목록 맨 위에 따로 붙인다(아래 6)
  const headsOf = (having: string) => {
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
           HAVING ${having}
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

    const heads = new Map<string, Head>();
    for (const r of raw) {
      let h = heads.get(r.sono);
      if (!h) {
        h = { so_no: r.sono, mo: null, cname: null, grp: null, due: null, seq: null, pm: null, sts: new Set(), items: new Map() };
        heads.set(r.sono, h);
      }
      h.mo ??= r.mo;
      h.cname ??= r.cname;
      h.grp ??= r.grp;
      h.pm ??= r.pm;
      h.sts.add(r.st);
      if (r.due && (!h.due || r.due < h.due)) h.due = r.due;
      if (r.seq != null && (h.seq == null || r.seq < h.seq)) h.seq = r.seq;
      const it = h.items.get(r.item_code) ?? { qty: 0, name: r.item_name };
      it.qty += r.qty ?? 0;
      h.items.set(r.item_code, it);
    }
    return heads;
  };
  type Head = { so_no: string; mo: string | null; cname: string | null; grp: string | null; due: string | null; seq: number | null; pm: string | null; sts: Set<string>; items: Map<string, { qty: number; name: string | null }> };
  const heads = headsOf(`SUM(CASE WHEN st IN ('수주', 'Packing') THEN 1 ELSE 0 END) > 0`);
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

  // 3-2) 모델(BOM 대표코드)별 착색재고 — LOT의 BASE·착색 인쇄 실적(일일작업현황) 호기로 무도수/유도수를 나눈다
  const colorMap = new Map<string, { mu: number; yu: number }>();
  for (const r of db
    .prepare(
      `SELECT c.parent_item_code p,
              SUM(CASE WHEN ${COLOR_MU} THEN COALESCE(i.stock_qty, 0) ELSE 0 END) mu,
              SUM(CASE WHEN ${COLOR_MU} THEN 0 ELSE COALESCE(i.stock_qty, 0) END) yu
         FROM (SELECT DISTINCT b.parent_item_code, b.child_item_code
                 FROM bom b JOIN items it ON it.item_code = b.child_item_code
                WHERE it.category = '반제품' AND json_extract(it.detail, '$."품목군"') = '착색') c
         JOIN inventory_status i ON i.item_code = c.child_item_code AND i.warehouse = ?
         LEFT JOIN (SELECT lot_no,
                           MAX(CASE WHEN json_extract(detail, '$."공정명"') = 'Base 인쇄' THEN 1 END) has_base,
                           MIN(CASE WHEN json_extract(detail, '$."공정명"') = 'Base 인쇄' THEN json_extract(detail, '$."라인"') LIKE '자동%' END) base_auto,
                           MAX(json_extract(detail, '$."공정명"') = '착색 인쇄' AND json_extract(detail, '$."라인"') LIKE '자동%') color_auto
                      FROM daily_work_status
                     WHERE json_extract(detail, '$."공정명"') IN ('Base 인쇄', '착색 인쇄')
                       AND lot_no IN (SELECT lot_no FROM inventory_status WHERE warehouse = ?)
                     GROUP BY lot_no) l ON l.lot_no = i.lot_no
        GROUP BY c.parent_item_code`
    )
    .all(COLOR_WAREHOUSE, COLOR_WAREHOUSE) as { p: string; mu: number; yu: number }[]) {
    colorMap.set(r.p, { mu: r.mu ?? 0, yu: r.yu ?? 0 });
  }

  // 4) 수주번호·품목별 출고, 수주번호별 마지막 출고일
  const shipMap = new Map<string, number>();
  const lastShip = new Map<string, string>();
  for (const r of db
    .prepare(
      `SELECT so_no, item_code, SUM(COALESCE(CAST(json_extract(detail, '$."출고수량"') AS REAL), 0)) q, MAX(ship_date) d
         FROM product_shipment_status WHERE so_no IS NOT NULL GROUP BY so_no, item_code`
    )
    .all() as { so_no: string; item_code: string; q: number; d: string | null }[]) {
    const so = soBase(r.so_no.trim());
    const k = `${so}|${r.item_code}`;
    shipMap.set(k, (shipMap.get(k) ?? 0) + (r.q ?? 0));
    if (r.d && r.d > (lastShip.get(so) ?? "")) lastShip.set(so, r.d);
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
        ...colorStockOf(colorMap.get(code.length >= 9 ? code.slice(0, 9) : code), powerOf(code)),
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
      status: [...h.sts].sort().join("/"),
      seq: h.seq,
      line_count: ls.length,
      order_qty,
      shipped,
      wip: STAGES.map((_, i) => ordered_.reduce((s, l) => s + l.wip[i], 0)),
      color_stock: [...new Map(ls.map((l) => [l.model, l.model_color_stock])).values()].reduce((s, v) => s + v, 0),
      shorts: SHORT_NAMES.map((_, k) => ls.reduce((s, l) => s + (l.shorts[k] ?? 0), 0)),
      assy_in: ls.reduce((s, l) => s + l.assy_in, 0),
      ship_short,
      ship_rate: order_qty > 0 ? Math.min(1, Math.max(0, shipped / order_qty)) : 0,
    };
  });

  // 6) 최근 1개월 안에 출고된 완료 수주 — "출하 완료 숨기기"를 끄면 보이도록 목록 맨 위에 붙인다(2026-10-23 사용자 요청).
  //    마지막 출고일 오래된 순이라 아래로 진행 수주 순위 1위와 날짜가 이어진다.
  //    순위·누적주문·부족분·조립투입·자재일정 계산에는 넣지 않는다. 출고 기록이 없으면 납기일이 최근 1개월 안인 것.
  const now = new Date();
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayStr = ymd(now);
  const since = ymd(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()));
  const doneRows: DueOrderRow[] = [];
  for (const h of headsOf(`SUM(CASE WHEN st IN ('수주', 'Packing') THEN 1 ELSE 0 END) = 0 AND SUM(CASE WHEN st = '완료' THEN 1 ELSE 0 END) > 0`).values()) {
    const ls0 = lastShip.get(h.so_no) ?? null;
    const recent = ls0 ? ls0.slice(0, 10) >= since : !!h.due && h.due.slice(0, 10) >= since && h.due.slice(0, 10) <= todayStr;
    if (!recent) continue;
    const ls: DueOrderLine[] = [...h.items].map(([code, it]) => ({
      item_code: code,
      model: code.length >= 9 ? code.slice(0, 9) : code,
      power: powerOf(code),
      item_name: it.name,
      order_qty: it.qty,
      cum_order: 0,
      wip: STAGES.map(() => 0),
      shipped: shipMap.get(`${h.so_no}|${code}`) ?? 0,
      cum_shipped: 0,
      base_stock: 0,
      color_stock: 0,
      model_color_stock: 0,
      model_color_mu: 0,
      shorts: SHORT_NAMES.map(() => null),
      assy_in: 0,
    }));
    ls.sort((a, b) => (a.model === b.model ? (b.power ?? 0) - (a.power ?? 0) : a.model < b.model ? -1 : 1));
    lines.set(h.so_no, ls);
    const order_qty = ls.reduce((s, l) => s + l.order_qty, 0);
    const shipped = ls.reduce((s, l) => s + l.shipped, 0);
    doneRows.push({
      rank: 0,
      so_no: h.so_no,
      mo_no: h.mo,
      customer: h.cname,
      brand: h.grp,
      due_date: h.due,
      pack_method: h.pm,
      status: [...h.sts].sort().join("/"),
      seq: h.seq,
      line_count: ls.length,
      order_qty,
      shipped,
      wip: STAGES.map(() => 0),
      color_stock: 0,
      shorts: SHORT_NAMES.map(() => 0),
      assy_in: 0,
      ship_short: 0,
      ship_rate: order_qty > 0 ? Math.min(1, shipped / order_qty) : 1,
      done: true,
      last_ship: ls0,
    });
  }
  doneRows.sort((a, b) => (a.last_ship ?? a.due_date ?? "").localeCompare(b.last_ship ?? b.due_date ?? ""));

  const one = (sql: string) => ((db.prepare(sql).get() as { v: string | null } | undefined)?.v ?? null);
  const result: DueOrdersResult = {
    rows: [...doneRows, ...rows],
    as_of: {
      sales: one("SELECT MAX(created_at) v FROM sales_orders"),
      wip: one("SELECT MAX(uploaded_at) v FROM process_wip_status"),
      inventory: one("SELECT MAX(uploaded_at) v FROM inventory_status"),
      shipment: one("SELECT MAX(ship_date) v FROM product_shipment_status"),
    },
    straight_rate: STRAIGHT_RATE,
  };
  return { at: Date.now(), result, lines, colors: colorMap };
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

/** 상세 기본 도수표(품목코드 끝 4자리) — 0.00 ~ -6.00은 0.25, -6.50 ~ -10.00은 0.50 간격(BASE-01 품목의 도수 구성과 같다) */
const POWER_GRID = [
  ...Array.from({ length: 25 }, (_, i) => i * 25),
  ...Array.from({ length: 8 }, (_, i) => 650 + i * 50),
].map((n) => String(n).padStart(4, "0"));

export function fetchDueOrderLines(
  db: DatabaseSync,
  soNo: string
): { row: DueOrderRow | null; lines: DueOrderLine[]; /** 수주에 든 모델들의 실링지 재고(같은 자재코드는 한 번만) */ seal?: { codes: string[]; stock: number } } {
  const c = load(db);
  const lines = c.lines.get(soNo) ?? [];
  const row0 = c.result.rows.find((r) => r.so_no === soNo) ?? null;
  if (lines.length === 0 || row0?.done) return { row: row0, lines }; // 완료 수주는 주문·출고만

  // 고객 요청 도수(예: 0.00, -0.50) 외에 도수변경(-0.25 등)으로 생긴 재공도 보이도록, 수주에 든 모델마다
  // 기본 도수표 + 재공이 있는 도수를 덧붙인다. 덧붙인 줄은 수주 계산(주문·부족분·조립투입)에 들어가지 않는다.
  const like = (m: string) => `${m}-%`;
  const models = [...new Set(lines.map((l) => l.model))];
  const items = new Map<string, { use_yn: string; name: string | null }>();
  const wip = new Map<string, number[]>();
  const base = new Map<string, number>();
  const stageSql = STAGES.map((s, i) => `SUM(COALESCE(CAST(json_extract(detail, '$."${s}"') AS REAL), 0)) s${i}`).join(", ");
  for (const m of models) {
    for (const r of db.prepare("SELECT item_code, use_yn, item_name FROM items WHERE item_code LIKE ?").all(like(m)) as { item_code: string; use_yn: string; item_name: string | null }[]) {
      items.set(r.item_code, { use_yn: r.use_yn, name: r.item_name });
    }
    for (const r of db.prepare(`SELECT item_code, ${stageSql} FROM process_wip_status WHERE item_code LIKE ? GROUP BY item_code`).all(like(m)) as Record<string, number | string>[]) {
      wip.set(String(r.item_code), STAGES.map((_, i) => Number(r[`s${i}`]) || 0));
    }
    for (const r of db
      .prepare(`SELECT item_code, SUM(COALESCE(stock_qty, 0)) q FROM inventory_status WHERE item_code LIKE ? AND warehouse IN (${BASE_WAREHOUSES.map(() => "?").join(",")}) GROUP BY item_code`)
      .all(like(m), ...BASE_WAREHOUSES) as { item_code: string; q: number }[]) {
      base.set(r.item_code, r.q ?? 0);
    }
  }

  const out: DueOrderLine[] = lines.map((l) => ({ ...l, use_yn: items.get(l.item_code)?.use_yn ?? null }));
  const have = new Set(lines.map((l) => l.item_code));
  for (const m of models) {
    const withWip = [...wip.entries()].filter(([code, w]) => code.startsWith(`${m}-`) && w.some((v) => v > 0)).map(([code]) => code);
    const codes = new Set([...POWER_GRID.map((p) => `${m}-${p}`), ...withWip]);
    for (const code of codes) {
      if (have.has(code)) continue;
      out.push({
        item_code: code,
        model: m,
        power: powerOf(code),
        item_name: items.get(code)?.name ?? null,
        order_qty: 0,
        cum_order: 0,
        wip: wip.get(code) ?? STAGES.map(() => 0),
        shipped: 0,
        cum_shipped: 0,
        base_stock: base.get(code) ?? 0,
        ...colorStockOf(c.colors.get(m), powerOf(code)),
        shorts: SHORT_NAMES.map(() => null),
        assy_in: 0,
        use_yn: items.get(code)?.use_yn ?? null,
        extra: true,
      });
    }
  }

  // 도수변경 건수 — 조립일자("조립 실적 입력시각"의 날짜, 지시일자와 다른 경우가 많다)가 최근 1개월인
  // 이전도수가 있고 실제도수와 다른 행을 작업지시번호로 중복 제거해 이전도수(이전품목) 줄에 센다 —
  // -4.25로 지시했다가 -4.00으로 조립했으면 -4.25 줄(2026-10-25 사용자 요청).
  // 입력시각이 비어 깨진 문자로 들어온 행은 날짜 범위에 걸리지 않아 저절로 빠진다.
  const { from, to } = dosuChangeWindow();
  const changes = new Map<string, number>();
  for (const m of models) {
    for (const r of db
      .prepare(
        `SELECT ${PREV_ITEM} prev, COUNT(DISTINCT wo_no) n FROM dosu_change_status
          WHERE item_code LIKE ? AND ${DOSU_CHANGE_COND}
          GROUP BY prev`
      )
      .all(like(m), from, to) as { prev: string | null; n: number }[]) {
      if (r.prev) changes.set(r.prev, r.n);
    }
  }
  for (const l of out) l.dosu_changes = changes.get(l.item_code) ?? 0;

  // 실링지재고 — 모델의 BOM 직접 구성품 중 BFS 자재의 부자재 창고 재고(자재수급 PUR-03과 같은 창고)
  //  수주 합계(상단 요약 칸)는 여러 모델이 같은 실링지를 쓰면 한 번만 센다
  const sealOf = new Map<string, number>();
  for (const m of models) {
    const codes = (db.prepare("SELECT DISTINCT child_item_code c FROM bom WHERE parent_item_code = ? AND child_item_code LIKE 'BFS%'").all(m) as { c: string }[]).map((r) => r.c);
    for (const code of codes) {
      if (sealOf.has(code)) continue;
      const r = db
        .prepare(`SELECT SUM(COALESCE(stock_qty, 0)) q FROM inventory_status WHERE item_code = ? AND warehouse IN (${SEAL_WAREHOUSES.map(() => "?").join(",")})`)
        .get(code, ...SEAL_WAREHOUSES) as { q: number | null } | undefined;
      sealOf.set(code, r?.q ?? 0);
    }
    const q = codes.reduce((s, code) => s + (sealOf.get(code) ?? 0), 0);
    for (const l of out) {
      if (l.model !== m) continue;
      l.seal_stock = q;
      l.seal_codes = codes;
    }
  }
  const seal = { codes: [...sealOf.keys()], stock: [...sealOf.values()].reduce((s, v) => s + v, 0) };

  // 조립투입 표시(모든 사용자 공유)
  const marks = assyMarks(db, soNo);
  for (const l of out) l.assy_mark = marks.get(l.item_code) ?? null;

  // 품목변경 — 검사부족이 있는 도수만, 같은 모델의 다른 도수 재공 중 측정 도수가 허용오차 안인 수량
  for (const m of models) {
    const cands = itemChangeCandidates(db, m);
    for (const l of out) {
      if (l.model !== m || l.extra || !(l.shorts[2] ?? 0) || l.power == null) continue;
      l.item_change = cands.filter((x) => fitsPower(x, l.power!)).reduce((s, x) => s + x.qty, 0);
    }
  }
  return { row: c.result.rows.find((r) => r.so_no === soNo) ?? null, lines: out, seal };
}

/** 도수변경 건수 집계 기간 — 오늘 기준 최근 1개월(조립일자) */
function dosuChangeWindow(): { from: string; to: string } {
  const d = new Date();
  const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const to = ymd(d);
  d.setMonth(d.getMonth() - 1);
  return { from: ymd(d), to };
}

const ASSY_DATE = `replace(substr(json_extract(detail, '$."조립 실적 입력시각"'), 1, 10), '.', '-')`;
/** 조립일자가 기간(?, ?) 안인 행 */
const ASSY_IN_WINDOW = `${ASSY_DATE} BETWEEN ? AND ?`;
/** 이전도수(숫자)가 있고 실제도수와 다른 행 = 도수변경. 원본에 이전도수=실제도수(이전품목이 자기 자신)인 행도 있어 뺀다 */
const CHANGED = `typeof(json_extract(detail, '$."이전도수"')) IN ('integer', 'real')
  AND json_extract(detail, '$."이전도수"') IS NOT json_extract(detail, '$."실제도수"')`;
const DOSU_CHANGE_COND = `${ASSY_IN_WINDOW} AND ${CHANGED}`;
/** 이전품목 = 이전도수의 품목코드(2026-10 데이터 13,510행 모두 같은 모델·이전도수와 일치) */
const PREV_ITEM = `NULLIF(TRIM(json_extract(detail, '$."이전품목"')), '')`;
const SEAL_WAREHOUSES = ["원.부자재창고", "포장창고", "조립창고"];

// 조립투입 표시 — 도수별 상세에서 조립투입 칸을 눌러 "투입함"으로 표시한 수주×품목(2026-10-25 사용자 요청, 모든 사용자 공유).
// 계산과 무관한 표시용이고 다시 누르면 풀린다. 표시할 때의 공정재공현황·현재고현황 업로드 시각(wip_at·inv_at)을 같이 저장해 두고,
// 두 자료가 모두 그 뒤에 새로 올라오면(실제 투입이 재공·재고에 반영되면) 표시를 지운다(2026-10-25 사용자 요청).
function ensureAssyMarkTable(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS due_order_assy_marks (
    so_no TEXT NOT NULL,
    item_code TEXT NOT NULL,
    qty REAL NOT NULL DEFAULT 0,
    marked_by TEXT,
    marked_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    wip_at TEXT,
    inv_at TEXT,
    PRIMARY KEY (so_no, item_code)
  )`);
  // 업로드 시각 칸이 생기기 전에 만든 표시는 지금 업로드 시각을 넣어 다음 업로드까지 남긴다
  const cols = new Set((db.prepare("PRAGMA table_info(due_order_assy_marks)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("wip_at")) db.exec("ALTER TABLE due_order_assy_marks ADD COLUMN wip_at TEXT");
  if (!cols.has("inv_at")) db.exec("ALTER TABLE due_order_assy_marks ADD COLUMN inv_at TEXT");
  if (!cols.has("wip_at") || !cols.has("inv_at")) {
    const s = uploadStamps(db);
    db.prepare("UPDATE due_order_assy_marks SET wip_at = COALESCE(wip_at, ?), inv_at = COALESCE(inv_at, ?)").run(s.wip, s.inv);
  }
}

/** 공정재공현황·현재고현황의 마지막 업로드 시각 */
function uploadStamps(db: DatabaseSync): { wip: string; inv: string } {
  const one = (sql: string) => ((db.prepare(sql).get() as { v: string | null } | undefined)?.v ?? "");
  return { wip: one("SELECT MAX(uploaded_at) v FROM process_wip_status"), inv: one("SELECT MAX(uploaded_at) v FROM inventory_status") };
}

function assyMarks(db: DatabaseSync, soNo: string): Map<string, AssyMark> {
  ensureAssyMarkTable(db);
  const s = uploadStamps(db);
  db.prepare("DELETE FROM due_order_assy_marks WHERE COALESCE(wip_at, '') < ? AND COALESCE(inv_at, '') < ?").run(s.wip, s.inv);
  const rows = db.prepare("SELECT item_code, qty, marked_by, marked_at FROM due_order_assy_marks WHERE so_no = ?").all(soNo) as unknown as (AssyMark & { item_code: string })[];
  return new Map(rows.map(({ item_code, ...m }) => [item_code, m]));
}

export function setAssyMark(db: DatabaseSync, soNo: string, itemCode: string, qty: number, user: string | null) {
  ensureAssyMarkTable(db);
  const s = uploadStamps(db);
  db.prepare(
    `INSERT INTO due_order_assy_marks (so_no, item_code, qty, marked_by, marked_at, wip_at, inv_at) VALUES (?, ?, ?, ?, datetime('now','localtime'), ?, ?)
     ON CONFLICT(so_no, item_code) DO UPDATE SET qty = excluded.qty, marked_by = excluded.marked_by, marked_at = excluded.marked_at,
       wip_at = excluded.wip_at, inv_at = excluded.inv_at`
  ).run(soNo, itemCode, qty, user, s.wip, s.inv);
}

export function clearAssyMark(db: DatabaseSync, soNo: string, itemCode: string) {
  ensureAssyMarkTable(db);
  db.prepare("DELETE FROM due_order_assy_marks WHERE so_no = ? AND item_code = ?").run(soNo, itemCode);
}

export interface AssemblyRecord {
  wo_no: string;
  /** 실제로 조립된 품목코드 */
  item_code: string;
  /** 이전품목(이전도수의 품목코드) — 도수변경 건만 */
  prev_item: string | null;
  lot_no: string | null;
  assembled_at: string | null;
  machine: string | null;
  worker: string | null;
  power: number | null;
  prev_power: number | null;
  /** 이전도수가 있고 실제도수와 다른 작업지시 */
  changed: boolean;
  /** 창을 연 도수에서 다른 도수로 변경된 작업지시(그 도수 줄의 도수변경 건수에 들어간 것) */
  from_here: boolean;
  upper1: number | null;
  upper2: number | null;
  lower1: number | null;
  lower2: number | null;
  p1: number | null;
  p2: number | null;
  p3: number | null;
  /** 착색품·하몰드 RADIUS — 투입 LOT No 끝 3자리(예: -726). 하몰드 LOT가 여럿이면 서로 다른 값을 / 로 잇는다 */
  color_radius: string | null;
  mold_radius: string | null;
}

/**
 * 도수별 상세의 도수변경 건수를 누르면 보여줄 조립 기록 — 조립일자 최근 1개월 안에 그 품목코드와 위아래 도수(near = 상세 표의
 * 바로 위·아래 줄)로 조립된 작업지시 전부(도수변경 안 된 것 포함) + 그 품목코드에서 더 먼 도수로 변경된 작업지시.
 * 원본은 투입자재(HEMA·하몰드·착색)별로 행이 나뉘어 있어 작업지시번호당 1줄로 합친다.
 * Radius는 품목정보·MOLD입고현황 모두 0으로만 들어와 있어, 투입 LOT No 끝 3자리(상몰드1·2와 같은 단위)를 쓴다.
 */
export function fetchAssemblyRecords(db: DatabaseSync, itemCode: string, near: string[] = []): { from: string; to: string; records: AssemblyRecord[] } {
  const { from, to } = dosuChangeWindow();
  const keys = ["조립 실적 입력시각", "조립 호기", "조립자", "실제도수", "이전도수", "상몰드1", "상몰드2", "하몰드1", "하몰드2", "도수1", "도수2", "도수3", "조립투입품목명", "조립투입LOT No"];
  const codes = [...new Set([itemCode, ...near])];
  const raw = db
    .prepare(
      `SELECT wo_no, lot_no, item_code, ${PREV_ITEM} prev, ${keys.map((k, i) => `json_extract(detail, '$."${k}"') k${i}`).join(", ")}
         FROM dosu_change_status
        WHERE (item_code IN (${codes.map(() => "?").join(",")}) OR (item_code LIKE ? AND ${PREV_ITEM} = ?)) AND ${ASSY_IN_WINDOW}
        ORDER BY id`
    )
    .all(...codes, `${itemCode.slice(0, 9)}-%`, itemCode, from, to) as Record<string, string | number | null>[];
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  const radius = (lot: unknown) => /-(\d{3})$/.exec(String(lot ?? ""))?.[1] ?? null;
  const byWo = new Map<string, AssemblyRecord & { molds: Set<string> }>();
  for (const r of raw) {
    const wo = String(r.wo_no);
    let a = byWo.get(wo);
    if (!a) {
      const changed = num(r.k4) != null && num(r.k4) !== num(r.k3);
      a = {
        wo_no: wo,
        item_code: String(r.item_code),
        prev_item: changed ? str(r.prev) : null,
        lot_no: str(r.lot_no),
        assembled_at: str(r.k0),
        machine: str(r.k1),
        worker: str(r.k2),
        power: num(r.k3),
        prev_power: num(r.k4),
        changed,
        from_here: changed && str(r.prev) === itemCode,
        upper1: num(r.k5),
        upper2: num(r.k6),
        lower1: num(r.k7),
        lower2: num(r.k8),
        p1: num(r.k9),
        p2: num(r.k10),
        p3: num(r.k11),
        color_radius: null,
        mold_radius: null,
        molds: new Set(),
      };
      byWo.set(wo, a);
    }
    const name = String(r.k12 ?? "");
    const rad = radius(r.k13);
    if (rad && name.includes("착색")) a.color_radius ??= rad;
    else if (rad && name.includes("하몰드")) a.molds.add(rad);
  }
  const records = [...byWo.values()]
    .map(({ molds, ...a }) => ({ ...a, mold_radius: molds.size ? [...molds].sort().join("/") : null }))
    .sort((x, y) => ((x.assembled_at ?? "") < (y.assembled_at ?? "") ? 1 : (x.assembled_at ?? "") > (y.assembled_at ?? "") ? -1 : 0));
  return { from, to, records };
}

export interface ColorStockLot {
  item_code: string;
  item_name: string | null;
  lot_no: string;
  location: string | null;
  stock_qty: number;
  /** 무도수용(0.00·유도수 모두 사용) / 유도수용(유도수만) */
  use: "무도수용" | "유도수용";
  /** 판정 근거 — BASE 인쇄 호기(실적 없으면 빈 배열) */
  base_lines: string[];
  /** 착색 인쇄 호기(실적 없으면 빈 배열) */
  color_lines: string[];
  /** BASE 인쇄를 자동Base·Back 호기 양쪽에서 한 LOT(처리 보류, 우선 유도수용) */
  pending: boolean;
}

/**
 * 도수별 상세의 착색재고를 누르면 보여줄 현재고 — 모델(BOM 대표코드)의 착색 반제품 조립창고 재고를 LOT별로,
 * 무도수용/유도수용 판정(colorMap과 같은 규칙)과 근거 호기를 붙여 돌려준다.
 */
export function fetchColorStock(db: DatabaseSync, model: string): { model: string; lots: ColorStockLot[] } {
  const stock = db
    .prepare(
      `SELECT i.item_code, it.item_name, i.lot_no, json_extract(i.detail, '$."Location"') loc, SUM(COALESCE(i.stock_qty, 0)) q
         FROM inventory_status i JOIN items it ON it.item_code = i.item_code
        WHERE i.warehouse = ? AND i.stock_qty > 0
          AND i.item_code IN (SELECT b.child_item_code FROM bom b JOIN items c ON c.item_code = b.child_item_code
                               WHERE b.parent_item_code = ? AND c.category = '반제품' AND json_extract(c.detail, '$."품목군"') = '착색')
        GROUP BY i.item_code, i.lot_no`
    )
    .all(COLOR_WAREHOUSE, model) as { item_code: string; item_name: string | null; lot_no: string; loc: string | null; q: number }[];
  const prints = new Map<string, { base: Set<string>; color: Set<string> }>();
  if (stock.length) {
    const lots = [...new Set(stock.map((s) => s.lot_no))];
    for (const r of db
      .prepare(
        `SELECT DISTINCT lot_no, json_extract(detail, '$."공정명"') p, json_extract(detail, '$."라인"') line
           FROM daily_work_status
          WHERE json_extract(detail, '$."공정명"') IN ('Base 인쇄', '착색 인쇄') AND lot_no IN (${lots.map(() => "?").join(",")})`
      )
      .all(...lots) as { lot_no: string; p: string; line: string | null }[]) {
      const x = prints.get(r.lot_no) ?? { base: new Set<string>(), color: new Set<string>() };
      (r.p === "Base 인쇄" ? x.base : x.color).add(r.line ?? "");
      prints.set(r.lot_no, x);
    }
  }
  const isAuto = (l: string) => l.startsWith("자동");
  const lots: ColorStockLot[] = stock.map((s) => {
    const p = prints.get(s.lot_no);
    const base = [...(p?.base ?? [])].sort();
    const color = [...(p?.color ?? [])].sort();
    const pending = base.some(isAuto) && !base.every(isAuto);
    const mu = base.length ? base.every(isAuto) : color.some(isAuto);
    return { item_code: s.item_code, item_name: s.item_name, lot_no: s.lot_no, location: s.loc, stock_qty: s.q, use: mu ? "무도수용" : "유도수용", base_lines: base, color_lines: color, pending };
  });
  lots.sort((a, b) => (a.use !== b.use ? (a.use === "무도수용" ? -1 : 1) : a.item_code !== b.item_code ? (a.item_code < b.item_code ? -1 : 1) : a.lot_no < b.lot_no ? -1 : 1));
  return { model, lots };
}

/** 품목변경 허용오차 — 외관검사 측정 도수(도수1~3)가 모두 목표 도수 ±0.225 안이면 그 도수로 바꿔 쓸 수 있다 */
export const ITEM_CHANGE_TOLERANCE = 0.225;
/** 품목변경 후보로 보는 공정 — 외관검사를 마친 뒤(이재기~출하포장). 검사부족 = 이 공정들 재공으로 채우는 부족분이다 */
const AFTER_INSPECTION = STAGES.slice(STAGES.indexOf("외관검사") + 1);

export interface ItemChangeCandidate {
  item_code: string;
  power: number | null;
  wo_no: string;
  lot_no: string | null;
  qty: number;
  /** 수량이 있는 공정과 그 수량 */
  stages: { stage: string; qty: number }[];
  /** 외관검사 측정 도수(도수1~3, 부호 없음 — -2.00 품목은 2.00 근처). 외관검사 실적이 여러 줄이면 모두 모은다 */
  samples: number[];
}

/** 모델의 외관검사 이후 재공을 작업지시별로, 그 작업지시의 외관검사 측정값과 함께 — 외관검사 실적이 없는(2025년 이전) 작업지시는 뺀다 */
function itemChangeCandidates(db: DatabaseSync, model: string): ItemChangeCandidate[] {
  const glob = `${model}-*`;
  const samples = new Map<string, number[]>();
  for (const r of db
    .prepare(
      `SELECT item_code, wo_no, json_extract(detail, '$."도수1"') a, json_extract(detail, '$."도수2"') b, json_extract(detail, '$."도수3"') c
         FROM daily_work_status WHERE item_code GLOB ? AND process_code = 'P360'`
    )
    .all(glob) as { item_code: string; wo_no: string; a: unknown; b: unknown; c: unknown }[]) {
    const k = `${r.item_code}|${r.wo_no}`;
    const xs = samples.get(k) ?? [];
    for (const v of [r.a, r.b, r.c]) if (typeof v === "number") xs.push(v);
    samples.set(k, xs);
  }
  const stageSql = AFTER_INSPECTION.map((s, i) => `COALESCE(CAST(json_extract(detail, '$."${s}"') AS REAL), 0) s${i}`).join(", ");
  const out: ItemChangeCandidate[] = [];
  for (const r of db.prepare(`SELECT item_code, wo_no, lot_no, ${stageSql} FROM process_wip_status WHERE item_code GLOB ?`).all(glob) as Record<string, string | number | null>[]) {
    const stages = AFTER_INSPECTION.map((stage, i) => ({ stage, qty: Number(r[`s${i}`]) || 0 })).filter((s) => s.qty > 0);
    const qty = stages.reduce((s, x) => s + x.qty, 0);
    const xs = samples.get(`${r.item_code}|${r.wo_no}`);
    if (qty <= 0 || !xs?.length) continue;
    const code = String(r.item_code);
    out.push({ item_code: code, power: powerOf(code), wo_no: String(r.wo_no), lot_no: r.lot_no == null ? null : String(r.lot_no), qty, stages, samples: xs });
  }
  return out;
}

/** 다른 도수의 재공이 목표 도수(power, 예: -2)로 쓸 수 있는지 — 측정값이 모두 |목표| ±0.225(부동소수 오차 감안) */
function fitsPower(c: ItemChangeCandidate, power: number): boolean {
  if (c.power === power) return false;
  const target = -power;
  return c.samples.every((v) => Math.abs(v - target) <= ITEM_CHANGE_TOLERANCE + 1e-9);
}

/** 도수별 상세의 품목변경 수량을 누르면 보여줄 후보 재공 */
export function fetchItemChange(db: DatabaseSync, itemCode: string): { item_code: string; power: number | null; tolerance: number; candidates: ItemChangeCandidate[] } {
  const power = powerOf(itemCode);
  const model = itemCode.length >= 9 ? itemCode.slice(0, 9) : itemCode;
  const candidates = power == null ? [] : itemChangeCandidates(db, model).filter((c) => fitsPower(c, power));
  candidates.sort((a, b) => (a.item_code !== b.item_code ? (a.item_code < b.item_code ? -1 : 1) : b.qty - a.qty));
  return { item_code: itemCode, power, tolerance: ITEM_CHANGE_TOLERANCE, candidates };
}

/** 자재수급(PUR-03)처럼 수주별 품목 줄까지 한꺼번에 쓰는 화면용 — 같은 30초 캐시를 쓴다 */
export function fetchDueOrdersWithLines(db: DatabaseSync): { rows: DueOrderRow[]; lines: Map<string, DueOrderLine[]>; as_of: DueOrdersResult["as_of"] } {
  const c = load(db);
  return { rows: c.result.rows.filter((r) => !r.done), lines: c.lines, as_of: c.result.as_of };
}
