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
//  - 발주: 구매발주등록(PUR-01) 상태 '발주'·'입고'인 줄의 수량·납기일자 (미입고 발주로 본다)
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
}

export interface MaterialRow {
  so_no: string;
  mo_no: string | null;
  customer: string | null;
  brand: string | null;
  due_date: string | null;
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

type Po = { po_no: string; due: string | null; qty: number };

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
  const poMap = new Map<string, Po[]>();
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
        `SELECT item_code, po_no, json_extract(detail, '$."납기일자"') due, CAST(json_extract(detail, '$."수량"') AS REAL) qty
           FROM purchase_order_status
          WHERE json_extract(detail, '$."상태"') IN ('발주', '입고') AND item_code IN (${qs})`
      )
      .all(...codes) as { item_code: string; po_no: string | null; due: string | null; qty: number | null }[]) {
      const list = poMap.get(r.item_code) ?? [];
      list.push({ po_no: r.po_no ?? "", due: isoDate(r.due), qty: r.qty ?? 0 });
      poMap.set(r.item_code, list);
    }
    for (const list of poMap.values()) list.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  }

  // 4) 순위대로 같은 자재의 현재고를 이어받으며 소요량·과부족·발주 충당 계산
  const balance = new Map<string, number>(); // 자재코드 → 앞 줄 과부족
  const rank = { ok: 0, po: 1, late: 2, order: 3 } as const;
  const rows: MaterialRow[] = pre.map((p) => {
    const cells: Record<MaterialKind, MaterialCell[]> = { seal: [], box: [], label: [], manual: [] };
    const boms = bomMap.get(p.model) ?? [];
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
          late = !!(eta && p.head.due_date && eta > p.head.due_date.slice(0, 10));
        } else {
          state = "order";
          order_qty = deficit - pos.reduce((s, po) => s + po.qty, 0);
        }
      }
      const st: MaterialRow["status"] = state === "order" ? "order" : late ? "late" : state === "po" ? "po" : "ok";
      if (rank[st] > rank[worst]) worst = st;
      cells[b.kind].push({ code: b.code, name: nameMap.get(b.code) ?? null, qty_per: b.qty_per, need, stock, balance: bal, state, eta, po_no, order_qty, late });
    }
    return {
      so_no: p.head.so_no,
      mo_no: p.head.mo_no,
      customer: p.head.customer,
      brand: p.head.brand,
      due_date: p.head.due_date,
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
