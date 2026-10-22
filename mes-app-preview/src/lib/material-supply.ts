import type { DatabaseSync } from "node:sqlite";
import { fetchDueOrdersWithLines } from "@/lib/due-orders";

// 구매관리 "자재수급(PUR-03)" — 자재수급일정 엑셀(출하검토 시트)을 MES 데이터만으로 다시 계산한 것.
// 엑셀은 수주 한 줄(수주번호×모델)마다 실링지·단상자·라벨·설명서의 소요량·현재고·과부족·발주·입고예정을 사람이 적는 방식이다.
//
// 데이터 출처
//  - 출하 대상 수량: 납기별수주현황(PLAN-04, lib/due-orders.ts)의 줄별 부족분 — 순위(납기→작업순서)대로 쌓은 값이라
//    앞 수주가 재고를 먼저 쓰고, 한 줄이 새로 필요로 하는 수량 = 그 줄 부족분 − 바로 앞 같은 품목 줄 부족분.
//      · 실링지: 실링 부족분(실링 공정을 아직 못 거친 수량)  · 단상자·라벨·설명서: 출하부족(재고·출고로 못 채운 수량)
//  - 자재와 개당 사용량: BOM(기준정보)의 모델(대표코드) 직접 구성품 중 BFS(실링지)·BIP(단상자)·BIL(라벨)·BII(설명서)
//  - 현재고: 현재고현황(INV-02)의 부자재 창고(원.부자재창고·포장창고·조립창고) 재고 합
//  - 발주: 구매발주등록(PUR-01) 상태 '발주'인 줄의 수량·납기일자 (미입고 발주로 본다). '입고'는 입고가 이미 일어난 발주(일부 적게 들어와 닫힌 건 포함)라
//    재고에 반영돼 있으므로 미입고로 세지 않는다(수량 100/입고 98, 10,000/9,200 같은 사례로 확인).
//  - 발주일자·발주현황·납기일자: 구매발주등록(PUR-01) — 모자라는 만큼을 채우는 발주, 없으면 그 자재의 가장 최근 발주('중단' 제외)
//  - 입고일자: 구매입고등록(PUR-02) — 위 발주의 발주일자 이후 가장 최근 입고일(입고 전표에 발주번호가 없어 자재코드·날짜로 잇는다)
// 소요량 = 필요 수량 × 개당 사용량 × Loss(자재 종류별, 화면에서 바꿈)를 올림. 엑셀과 같이 현재고는 같은 자재의 앞 줄 과부족을
// 이어받는 누적이고(과부족 = 현재고 − 소요량), 모자라는 만큼은 납기 빠른 발주부터 채워 입고예정일을 붙인다.

export const MATERIAL_KINDS = [
  { key: "seal", label: "실링지", prefix: "BFS", stage: 4, loss: 120 },
  { key: "box", label: "단상자", prefix: "BIP", stage: 9, loss: 107 },
  { key: "label", label: "라벨", prefix: "BIL", stage: 9, loss: 110 },
  { key: "manual", label: "설명서", prefix: "BII", stage: 9, loss: 101 },
] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number]["key"];

const WAREHOUSES = ["원.부자재창고", "포장창고", "조립창고"];

export type CoverState = "ok" | "po" | "order";

/** 줄에 보여주는 발주 정보 — 구매발주등록(PUR-01)·구매입고등록(PUR-02) 기준 */
export interface PoRef {
  po_no: string;
  order_date: string | null;
  /** 납기일자 */
  due: string | null;
  /** 발주현황(상태): 발주 / 입고 / 완료 */
  status: string | null;
  /** 이 발주일자 이후 가장 최근 입고일 */
  receipt_date: string | null;
}

export interface MaterialCell {
  code: string;
  name: string | null;
  qty_per: number;
  /** 소요량(Loss 반영, 올림) */
  need: number;
  /** 이 줄 처리 전 현재고(같은 자재의 앞 줄 과부족을 이어받음) */
  stock: number;
  /** 과부족 = 현재고 − 소요량 */
  balance: number;
  state: CoverState;
  /** state='po' — 모자라는 만큼을 채우는 발주의 납기일·발주번호 */
  eta: string | null;
  po_no: string | null;
  /** state='order' — 발주해야 하는 수량(모자람 − 미입고 발주 합) */
  order_qty: number;
  /** 입고예정일이 수주 납기일보다 늦다 */
  late: boolean;
  /** 발주일자·발주현황·납기일자·입고일자에 보여줄 발주 — 없으면 null */
  ref: PoRef | null;
}

export interface MaterialRow {
  so_no: string;
  mo_no: string | null;
  customer: string | null;
  brand: string | null;
  /** 수주등록(SALES-02) 납기일자 — 이 수주의 이 모델 줄 중 가장 빠른 날 */
  due_date: string | null;
  /** 수주등록(SALES-02) 비고 — 이 수주의 이 모델 줄 비고(서로 다르면 ' / '로 이음) */
  memo: string | null;
  /** 모델 = 대표품목(품목코드 앞 9자리) */
  model: string;
  item_name: string | null;
  order_qty: number;
  shipped: number;
  /** 아직 출하하지 못한 수량(주문량 − 출고) */
  remain: number;
  cells: Record<MaterialKind, MaterialCell[]>;
  has_bom: boolean;
  /** 줄 전체 상태 — 가장 나쁜 자재 기준: order(발주필요) > late(납기 이후 입고) > po(입고예정) > ok */
  status: "ok" | "po" | "late" | "order";
}

export interface MaterialSupplyResult {
  rows: MaterialRow[];
  loss: Record<MaterialKind, number>;
  as_of: { inventory: string | null; purchase: string | null; sales: string | null };
  warehouses: string[];
}

/** 수주 한 건의 자재 한 종류 일정 — 그 수주의 모델 줄·자재 중 가장 나쁜 상태 */
export interface OrderMaterialStatus {
  /** none = 이 수주 모델들의 BOM에 그 종류 자재가 없음 */
  status: "ok" | "po" | "late" | "order" | "none";
  /** po·late — 모자라는 만큼을 채우는 발주 중 가장 늦은 입고예정일(다 들어오는 날) */
  eta: string | null;
  /** order — 발주해야 하는 수량 합 */
  order_qty: number;
}

/** 납기별수주현황(PLAN-04) 자재일정 열용 — 자재수급 줄을 수주번호별로 묶어 종류별 상태를 요약한다 */
export function summarizeByOrder(rows: MaterialRow[]): Record<string, { kinds: Record<MaterialKind, OrderMaterialStatus>; rows: MaterialRow[] }> {
  const rank = { none: -1, ok: 0, po: 1, late: 2, order: 3 } as const;
  const out: Record<string, { kinds: Record<MaterialKind, OrderMaterialStatus>; rows: MaterialRow[] }> = {};
  for (const r of rows) {
    const o = (out[r.so_no] ??= {
      kinds: Object.fromEntries(MATERIAL_KINDS.map((k) => [k.key, { status: "none", eta: null, order_qty: 0 }])) as Record<MaterialKind, OrderMaterialStatus>,
      rows: [],
    });
    o.rows.push(r);
    for (const k of MATERIAL_KINDS) {
      const s = o.kinds[k.key];
      for (const c of r.cells[k.key]) {
        const st = c.state === "order" ? "order" : c.late ? "late" : c.state === "po" ? "po" : "ok";
        if (rank[st] > rank[s.status]) s.status = st;
        if (c.state === "po" && c.eta && (!s.eta || c.eta > s.eta)) s.eta = c.eta;
        if (c.state === "order") s.order_qty += c.order_qty;
      }
    }
  }
  return out;
}

export function ensureSettingsTable(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS material_supply_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
}

export function loadLoss(db: DatabaseSync): Record<MaterialKind, number> {
  ensureSettingsTable(db);
  const loss = Object.fromEntries(MATERIAL_KINDS.map((k) => [k.key, k.loss])) as Record<MaterialKind, number>;
  for (const r of db.prepare("SELECT key, value FROM material_supply_settings WHERE key LIKE 'loss.%'").all() as { key: string; value: string }[]) {
    const k = r.key.slice(5) as MaterialKind;
    const v = Number(r.value);
    if (k in loss && Number.isFinite(v) && v >= 100 && v <= 500) loss[k] = v;
  }
  return loss;
}

export function saveLoss(db: DatabaseSync, loss: Partial<Record<MaterialKind, number>>) {
  ensureSettingsTable(db);
  const up = db.prepare(
    `INSERT INTO material_supply_settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','localtime')`
  );
  for (const k of MATERIAL_KINDS) {
    const v = loss[k.key];
    if (v == null) continue;
    if (!Number.isFinite(v) || v < 100 || v > 500) throw new Error(`${k.label} Loss는 100~500% 사이여야 합니다.`);
    up.run(`loss.${k.key}`, String(Math.round(v * 100) / 100));
  }
}

function isoDate(s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})/.exec(s.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

type Po = { po_no: string; due: string | null; qty: number; order_date: string | null; status: string | null };

export function fetchMaterialSupply(db: DatabaseSync): MaterialSupplyResult {
  const loss = loadLoss(db);
  const { rows: so, lines, as_of } = fetchDueOrdersWithLines(db);

  // 1) 수주 × 모델 줄과 줄별 새로 필요한 수량(실링 / 출하)
  type Pre = { head: (typeof so)[number]; model: string; item_name: string | null; order_qty: number; shipped: number; need: number[] };
  const pre: Pre[] = [];
  const prevS = new Map<string, number[]>(); // 품목코드 → 앞 줄의 [실링 부족분, 출하부족]
  for (const head of so) {
    const byModel = new Map<string, Pre>();
    for (const l of lines.get(head.so_no) ?? []) {
      const cur = [l.shorts[4] ?? 0, l.shorts[9] ?? 0];
      const prev = prevS.get(l.item_code) ?? [0, 0];
      prevS.set(l.item_code, cur);
      let p = byModel.get(l.model);
      if (!p) {
        p = { head, model: l.model, item_name: l.item_name, order_qty: 0, shipped: 0, need: [0, 0] };
        byModel.set(l.model, p);
      }
      p.order_qty += l.order_qty;
      p.shipped += l.shipped;
      p.need[0] += Math.max(0, cur[0] - prev[0]);
      p.need[1] += Math.max(0, cur[1] - prev[1]);
    }
    pre.push(...byModel.values());
  }

  // 1-2) 수주×모델별 납기일자·비고(SALES-02) — 수주번호 해석은 lib/due-orders.ts와 같다
  const soInfo = new Map<string, { due: string | null; memos: Set<string> }>();
  for (const r of db
    .prepare(
      `SELECT COALESCE(NULLIF(json_extract(detail, '$."수주번호"'), ''),
                CASE WHEN instr(so_no, '-') > 0 THEN substr(so_no, 1, instr(so_no, '-') - 1) ELSE so_no END) sono,
              substr(item_code, 1, 9) model, due_date due, NULLIF(TRIM(json_extract(detail, '$."비고"')), '') memo
         FROM sales_orders
        WHERE COALESCE(json_extract(detail, '$."상태"'), status) <> '중단'`
    )
    .all() as { sono: string; model: string; due: string | null; memo: string | null }[]) {
    const k = `${r.sono}|${r.model}`;
    const info = soInfo.get(k) ?? { due: null, memos: new Set<string>() };
    if (r.due && (!info.due || r.due < info.due)) info.due = r.due;
    if (r.memo) info.memos.add(r.memo);
    soInfo.set(k, info);
  }

  // 2) 모델별 BOM 자재
  const models = [...new Set(pre.map((p) => p.model))];
  const prefixes: string[] = MATERIAL_KINDS.map((k) => k.prefix);
  const bomMap = new Map<string, { code: string; kind: MaterialKind; qty_per: number }[]>();
  const sel = db.prepare(
    `SELECT child_item_code c, qty_per q FROM bom WHERE parent_item_code = ? AND substr(child_item_code, 1, 3) IN (${prefixes.map(() => "?").join(",")})`
  );
  for (const m of models) {
    const list = (sel.all(m, ...prefixes) as { c: string; q: number }[]).map((r) => ({
      code: r.c,
      kind: MATERIAL_KINDS.find((k) => k.prefix === r.c.slice(0, 3))!.key,
      qty_per: r.q,
    }));
    bomMap.set(m, list);
  }
  const codes = [...new Set([...bomMap.values()].flat().map((b) => b.code))];

  // 3) 자재 품명·현재고·미입고 발주
  const nameMap = new Map<string, string | null>();
  const stockMap = new Map<string, number>();
  const poMap = new Map<string, Po[]>(); // 미입고 발주(납기 빠른 순)
  const allPoMap = new Map<string, Po[]>(); // 중단 제외 전체 발주(최근 먼저)
  const receiptMap = new Map<string, string[]>(); // 입고일(최근 먼저)
  if (codes.length) {
    const qs = codes.map(() => "?").join(",");
    for (const r of db.prepare(`SELECT item_code, item_name FROM items WHERE item_code IN (${qs})`).all(...codes) as { item_code: string; item_name: string | null }[]) {
      nameMap.set(r.item_code, r.item_name);
    }
    const wq = WAREHOUSES.map(() => "?").join(",");
    for (const r of db
      .prepare(`SELECT item_code, SUM(COALESCE(stock_qty, 0)) q FROM inventory_status WHERE warehouse IN (${wq}) AND item_code IN (${qs}) GROUP BY item_code`)
      .all(...WAREHOUSES, ...codes) as { item_code: string; q: number }[]) {
      stockMap.set(r.item_code, r.q ?? 0);
    }
    for (const r of db
      .prepare(
        `SELECT item_code, po_no, order_date, json_extract(detail, '$."납기일자"') due, CAST(json_extract(detail, '$."수량"') AS REAL) qty,
                json_extract(detail, '$."상태"') st
           FROM purchase_order_status
          WHERE COALESCE(json_extract(detail, '$."상태"'), '') <> '중단' AND item_code IN (${qs})`
      )
      .all(...codes) as { item_code: string; po_no: string | null; order_date: string | null; due: string | null; qty: number | null; st: string | null }[]) {
      const po: Po = { po_no: r.po_no ?? "", due: isoDate(r.due), qty: r.qty ?? 0, order_date: isoDate(r.order_date), status: r.st };
      const all = allPoMap.get(r.item_code) ?? [];
      all.push(po);
      allPoMap.set(r.item_code, all);
      if (r.st === "발주") {
        const list = poMap.get(r.item_code) ?? [];
        list.push(po);
        poMap.set(r.item_code, list);
      }
    }
    for (const list of poMap.values()) list.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
    for (const list of allPoMap.values()) list.sort((a, b) => (b.order_date ?? "").localeCompare(a.order_date ?? "")); // 최근 발주 먼저
    // 입고일자 — 자재코드별 입고일(최근 먼저)
    for (const r of db
      .prepare(`SELECT item_code, receipt_date d FROM purchase_receipt_status WHERE receipt_date IS NOT NULL AND item_code IN (${qs}) GROUP BY item_code, receipt_date`)
      .all(...codes) as { item_code: string; d: string }[]) {
      const list = receiptMap.get(r.item_code) ?? [];
      list.push(isoDate(r.d) ?? r.d);
      receiptMap.set(r.item_code, list);
    }
    for (const list of receiptMap.values()) list.sort((a, b) => b.localeCompare(a));
  }

  // 4) 순위대로 같은 자재의 현재고를 이어받으며 소요량·과부족·발주 충당 계산
  const balance = new Map<string, number>(); // 자재코드 → 앞 줄 과부족
  const rank = { ok: 0, po: 1, late: 2, order: 3 } as const;
  const rows: MaterialRow[] = pre.map((p) => {
    const cells: Record<MaterialKind, MaterialCell[]> = { seal: [], box: [], label: [], manual: [] };
    const boms = bomMap.get(p.model) ?? [];
    const info = soInfo.get(`${p.head.so_no}|${p.model}`);
    const due = info?.due ?? p.head.due_date;
    let worst: MaterialRow["status"] = "ok";
    for (const b of boms) {
      const kind = MATERIAL_KINDS.find((k) => k.key === b.kind)!;
      const need = Math.ceil(Math.round(p.need[kind.stage === 4 ? 0 : 1] * b.qty_per * (loss[b.kind] / 100) * 1e6) / 1e6);
      const stock = balance.get(b.code) ?? stockMap.get(b.code) ?? 0;
      const bal = stock - need;
      balance.set(b.code, bal);
      let state: CoverState = "ok";
      let eta: string | null = null;
      let po_no: string | null = null;
      let order_qty = 0;
      let late = false;
      if (bal < 0) {
        const deficit = -bal;
        const pos = poMap.get(b.code) ?? [];
        let cum = 0;
        const hit = pos.find((po) => (cum += po.qty) >= deficit);
        if (hit) {
          state = "po";
          eta = hit.due;
          po_no = hit.po_no;
          late = !!(eta && due && eta > due.slice(0, 10));
        } else {
          state = "order";
          order_qty = deficit - pos.reduce((s, po) => s + po.qty, 0);
        }
      }
      // 보여줄 발주: 모자란 만큼을 채우는 발주, 아니면 그 자재의 가장 최근 발주
      const refPo = (state === "po" ? (poMap.get(b.code) ?? []).find((po) => po.po_no === po_no) : undefined) ?? (allPoMap.get(b.code) ?? [])[0];
      const ref: PoRef | null = refPo
        ? {
            po_no: refPo.po_no,
            order_date: refPo.order_date,
            due: refPo.due,
            status: refPo.status,
            receipt_date: (receiptMap.get(b.code) ?? []).find((d) => !refPo.order_date || d >= refPo.order_date) ?? null,
          }
        : null;
      const st: MaterialRow["status"] = state === "order" ? "order" : late ? "late" : state === "po" ? "po" : "ok";
      if (rank[st] > rank[worst]) worst = st;
      cells[b.kind].push({ code: b.code, name: nameMap.get(b.code) ?? null, qty_per: b.qty_per, need, stock, balance: bal, state, eta, po_no, order_qty, late, ref });
    }
    return {
      so_no: p.head.so_no,
      mo_no: p.head.mo_no,
      customer: p.head.customer,
      brand: p.head.brand,
      due_date: due,
      memo: info && info.memos.size ? [...info.memos].join(" / ") : null,
      model: p.model,
      item_name: p.item_name,
      order_qty: p.order_qty,
      shipped: p.shipped,
      remain: Math.max(0, p.order_qty - p.shipped),
      cells,
      has_bom: boms.length > 0,
      status: worst,
    };
  });

  const one = (sql: string) => ((db.prepare(sql).get() as { v: string | null } | undefined)?.v ?? null);
  return {
    rows,
    loss,
    as_of: {
      inventory: one("SELECT MAX(uploaded_at) v FROM inventory_status"),
      purchase: one("SELECT MAX(uploaded_at) v FROM purchase_order_status"),
      sales: as_of.sales,
    },
    warehouses: WAREHOUSES,
  };
}
