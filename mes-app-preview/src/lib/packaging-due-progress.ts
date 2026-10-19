import type { DatabaseSync } from "node:sqlite";

// 계획정보(PLAN-03) "납기진행" 탭 — "출하계획.xlsx"(납기별 시트, "종합_Order 공정별 진행사항")를 화면으로 옮긴 것.
// 수주번호 한 줄에 납기일·주문량과 중간창고 → 마킹(완검) → 출하까지 공정별 부족분과 진행율을 보여준다.
//  - 주문량·납기일·고객·품목군·개입수·포장유형: 수주등록(SALES-02)·거래처정보(BASE-06)·제품정보(BASE-01)
//  - 중간창고(P390)·마킹(P400): 일일작업현황(PROD-10) 양품수량. 줄에 수주번호가 있으면 그것을, 없으면 작업지시현황(PROD-05)의
//    작지번호 → 수주번호로 찾는다(중간창고 줄에는 수주번호가 비어 있다).
//  - 출하: 제품출고등록(SALES-03) 출고수량
// 부족분 = 주문량 − 실적(0 미만은 0), 진행율 = 실적 ÷ 주문량(100% 상한). 엑셀의 생산종료일·과생산은 손으로 적는 값이라 넣지 않았다.

export interface DueProgressRow {
  rank: number;
  so_no: string;
  mo_no: string | null;
  customer: string | null;
  brand: string | null;
  due_date: string | null;
  pack_method: string | null;
  pack_size: number | null;
  order_qty: number;
  packs: number | null;
  mid_short: number;
  mid_rate: number;
  mark_short: number;
  mark_rate: number;
  ship_short: number;
  ship_rate: number;
}

export interface DueProgressTotals {
  order_qty: number;
  mid_short: number;
  mid_rate: number;
  mark_short: number;
  mark_rate: number;
  ship_short: number;
  ship_rate: number;
}

export interface DueProgressResult {
  rows: DueProgressRow[];
  totals: DueProgressTotals;
}

function soBase(soNo: string): string {
  const i = soNo.indexOf("-");
  return i > 0 ? soNo.slice(0, i) : soNo;
}

// 일일작업현황은 공정코드·수주번호에 인덱스가 없어 매번 읽으면 느리다 — 수주번호별 합계를 한 번에 읽어 30초 동안 재사용한다
const stageCache = new WeakMap<DatabaseSync, { at: number; mid: Map<string, number>; mark: Map<string, number>; ship: Map<string, number> }>();

function sumBySo(rows: { so: string | null; q: number | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.so) continue;
    const k = soBase(r.so.trim());
    m.set(k, (m.get(k) ?? 0) + (r.q ?? 0));
  }
  return m;
}

function loadStageQty(db: DatabaseSync) {
  const hit = stageCache.get(db);
  if (hit && Date.now() - hit.at < 30_000) return hit;
  const stage = (code: string) =>
    sumBySo(
      db
        .prepare(
          `SELECT COALESCE(NULLIF(json_extract(d.detail, '$."수주번호"'), ''), NULLIF(w.so_no, '')) so,
                  SUM(CAST(json_extract(d.detail, '$."양품수량"') AS REAL)) q
             FROM daily_work_status d
             LEFT JOIN work_order_status w ON w.wo_no = d.wo_no
            WHERE d.process_code = ?
            GROUP BY so`
        )
        .all(code) as { so: string | null; q: number | null }[]
    );
  const ship = sumBySo(
    db
      .prepare(`SELECT so_no so, SUM(CAST(json_extract(detail, '$."출고수량"') AS REAL)) q FROM product_shipment_status GROUP BY so_no`)
      .all() as { so: string | null; q: number | null }[]
  );
  const next = { at: Date.now(), mid: stage("P390"), mark: stage("P400"), ship };
  stageCache.set(db, next);
  return next;
}

function rate(done: number, order: number): number {
  return order > 0 ? Math.min(1, Math.max(0, done / order)) : 0;
}

/** 진행 중인 수주(상태가 수주/Packing인 줄이 하나라도 있는 수주번호)를 납기일 순으로 읽어 공정별 진행을 붙인다 */
export function fetchDueProgress(db: DatabaseSync): DueProgressResult {
  const orders = db
    .prepare(
      `SELECT COALESCE(NULLIF(json_extract(so.detail, '$."수주번호"'), ''),
                       substr(so.so_no, 1, CASE WHEN instr(so.so_no, '-') > 0 THEN instr(so.so_no, '-') - 1 ELSE length(so.so_no) END)) sono,
              MAX(NULLIF(TRIM(json_extract(so.detail, '$."MO-번호"')), '')) mo,
              MAX(COALESCE(NULLIF(TRIM(cu.short_name), ''), json_extract(so.detail, '$."거래처명"'))) cname,
              MAX(json_extract(so.detail, '$."품목군"')) grp,
              SUM(so.order_qty) qty,
              MIN(so.due_date) due,
              MAX(json_extract(it.detail, '$."포장방법"')) pm,
              MAX(CAST(json_extract(it.detail, '$."포장단위수량"') AS INTEGER)) pk,
              MIN(CAST(json_extract(so.detail, '$."작업순서"') AS INTEGER)) seq
         FROM sales_orders so
         LEFT JOIN items it ON it.item_code = so.item_code
         LEFT JOIN customers cu ON cu.customer_code = so.customer_code
        WHERE REPLACE(COALESCE(json_extract(so.detail, '$."거래처명"'), ''), ' ', '') <> '(주)메디오스'
        GROUP BY sono
       HAVING SUM(CASE WHEN COALESCE(json_extract(so.detail, '$."상태"'), so.status) IN ('수주', 'Packing') THEN 1 ELSE 0 END) > 0
        ORDER BY due, CASE WHEN seq IS NULL THEN 1 ELSE 0 END, seq, sono`
    )
    .all() as { sono: string; mo: string | null; cname: string | null; grp: string | null; qty: number | null; due: string | null; pm: string | null; pk: number | null; seq: number | null }[];

  const { mid, mark, ship } = loadStageQty(db);
  const rows: DueProgressRow[] = orders.map((o, i) => {
    const qty = o.qty ?? 0;
    const pk = o.pk && o.pk > 0 ? o.pk : null;
    const midDone = mid.get(o.sono) ?? 0;
    const markDone = mark.get(o.sono) ?? 0;
    const shipDone = ship.get(o.sono) ?? 0;
    return {
      rank: i + 1,
      so_no: o.sono,
      mo_no: o.mo,
      customer: o.cname,
      brand: o.grp,
      due_date: o.due,
      pack_method: o.pm,
      pack_size: pk,
      order_qty: qty,
      packs: pk ? qty / pk : null,
      mid_short: Math.max(0, qty - midDone),
      mid_rate: rate(midDone, qty),
      mark_short: Math.max(0, qty - markDone),
      mark_rate: rate(markDone, qty),
      ship_short: Math.max(0, qty - shipDone),
      ship_rate: rate(shipDone, qty),
    };
  });
  return { rows, totals: sumTotals(rows) };
}

export function sumTotals(rows: DueProgressRow[]): DueProgressTotals {
  const order_qty = rows.reduce((s, r) => s + r.order_qty, 0);
  const mid_short = rows.reduce((s, r) => s + r.mid_short, 0);
  const mark_short = rows.reduce((s, r) => s + r.mark_short, 0);
  const ship_short = rows.reduce((s, r) => s + r.ship_short, 0);
  const r = (short: number) => (order_qty > 0 ? 1 - short / order_qty : 0);
  return { order_qty, mid_short, mid_rate: r(mid_short), mark_short, mark_rate: r(mark_short), ship_short, ship_rate: r(ship_short) };
}
