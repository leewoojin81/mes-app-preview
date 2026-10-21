import type { BlisterLot, NcrRecord, SupplyLot } from "@/lib/qc-incoming-shared";
import { BLISTER_DEFECT_NAMES, SUPPLY_DEFECT_NAMES } from "@/lib/qc-incoming-shared";

// 부적합 관리대장 계산 — 입고검사 대시보드(부적합 탭)의 items()/repData()와 같은 규칙.

export interface NcrItem {
  k: string;
  no: string;
  date: string;
  kind: string;
  lot: string;
  code: string;
  item: string;
  name: string;
  sup: string;
  insp: number;
  bad: number;
  rate: number;
  defs: string;
  judge: string;
  note: string;
  manual: boolean;
}

export type Seg = "" | "M" | "B";

/** 대상 로트: 직접 추가한 것 + 부적합이 있거나 판정이 "부적합"인 부자재 로트 + 부적합이 있는 블리스터 로트 중 부적합률 10% 이상 (직접 추가는 무조건 포함) */
export function buildNcrItems(lots: SupplyLot[], blister: BlisterLot[], records: NcrRecord[]): NcrItem[] {
  const out: NcrItem[] = [];
  for (const r of records) {
    if (!r.manual) continue;
    out.push({
      k: r.k,
      no: "M-" + r.k.slice(-4),
      date: r.date,
      kind: r.kind,
      lot: r.lot,
      code: r.code,
      item: r.item,
      name: r.name,
      sup: r.sup,
      insp: r.insp,
      bad: r.bad,
      rate: r.insp ? r.bad / r.insp : 0,
      defs: r.defs,
      judge: "",
      note: "직접 추가",
      manual: true,
    });
  }
  for (const r of lots) {
    if (!(r.bad_qty > 0 || r.result === "부적합")) continue;
    const df: string[] = [];
    (r.defs ?? []).forEach((v, j) => {
      if (v > 0 && SUPPLY_DEFECT_NAMES[j]) df.push(`${SUPPLY_DEFECT_NAMES[j]} ${v}`);
    });
    out.push({
      k: "L" + r.no,
      no: "L-" + r.no,
      date: r.insp_date || r.recv_date || "",
      kind: r.part || "",
      lot: r.lot_no || "",
      code: r.mat_code || "",
      item: r.item_code || "",
      name: r.name || "",
      sup: r.supplier || "",
      insp: r.insp_qty,
      bad: r.bad_qty,
      rate: r.insp_qty ? r.bad_qty / r.insp_qty : 0,
      defs: df.join(", "),
      judge: r.result || "",
      note: r.remark || "",
      manual: false,
    });
  }
  for (const r of blister) {
    if (!(r.bad_qty > 0)) continue;
    const df: string[] = [];
    r.defs.forEach((v, j) => {
      if (v > 0) df.push(`${BLISTER_DEFECT_NAMES[j]} ${v}`);
    });
    out.push({
      k: "B" + r.no + "_" + String(r.lot_no).replace(/[^\w-]/g, ""),
      no: "B-" + r.no,
      date: r.insp_date || r.recv_date || "",
      kind: "블리스터",
      lot: r.lot_no || "",
      code: r.mold || "",
      item: "",
      name: `${r.item || ""} ${r.mold || ""}`,
      sup: r.supplier || "",
      insp: r.insp_qty,
      bad: r.bad_qty,
      rate: r.insp_qty ? r.bad_qty / r.insp_qty : 0,
      defs: df.join(", "),
      judge: r.status || "",
      note: r.remark || "",
      manual: false,
    });
  }
  return out.filter((it) => it.manual || it.rate >= 0.1).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export const inSeg = (it: NcrItem, seg: Seg): boolean => !seg || (seg === "B" ? it.kind === "블리스터" : it.kind !== "블리스터");

// ── 보고(월별·자재별·불량추이) ────────────────────────────────────────────────────────────
interface Acc {
  q: number;
  b: number;
  n: number;
  s: [number, number, number];
}
const mk = (): Acc => ({ q: 0, b: 0, n: 0, s: [0, 0, 0] });

export interface RepData {
  M: Record<number, Acc>;
  P: Record<string, Acc>;
  D: Record<string, { t: number; m: Record<number, number> }>;
  T: Acc;
  ms: number[];
  ps: string[];
  ts: string[];
}

export function repData(
  seg: Seg,
  lots: SupplyLot[],
  blister: BlisterLot[],
  items: NcrItem[],
  stOf: (k: string) => string
): RepData {
  const M: RepData["M"] = {};
  const P: RepData["P"] = {};
  const D: RepData["D"] = {};
  const T = mk();
  const dd = (t: string, m: number, v: number) => {
    if (!(v > 0)) return;
    (D[t] ??= { t: 0, m: {} }).t += v;
    D[t].m[m] = (D[t].m[m] || 0) + v;
  };
  const acc = (m: number, part: string, q: number, b: number, names: readonly string[], vals: number[] | null) => {
    const x = (M[m] ??= mk());
    const y = (P[part] ??= mk());
    x.q += q;
    x.b += b;
    y.q += q;
    y.b += b;
    T.q += q;
    T.b += b;
    let sm = 0;
    (vals ?? []).forEach((v, j) => {
      v = +v || 0;
      if (v > 0) {
        dd(names[j], m, v);
        sm += v;
      }
    });
    if (b > sm) dd("유형 미기재", m, b - sm);
  };
  if (seg !== "B") {
    for (const r of lots) {
      const q = r.insp_qty || 0;
      const b = r.bad_qty || 0;
      const m = r.month;
      if (!m || (!q && !b)) continue;
      acc(m, r.part || "기타", q, b, SUPPLY_DEFECT_NAMES, r.defs);
    }
  }
  if (seg !== "M") {
    for (const r of blister) {
      const q = r.insp_qty || 0;
      const b = r.bad_qty || 0;
      const m = r.month;
      if (!m || (!q && !b)) continue;
      acc(m, "블리스터", q, b, BLISTER_DEFECT_NAMES, r.defs);
    }
  }
  for (const it of items) {
    if (!inSeg(it, seg)) continue;
    const m = Number(String(it.date).slice(5, 7));
    const k = stOf(it.k);
    const i = k === "미처리" ? 0 : k === "진행중" ? 1 : 2;
    const list = [(P[it.kind || "기타"] ??= mk()), T];
    if (m) list.push((M[m] ??= mk()));
    list.forEach((o) => {
      o.n++;
      o.s[i]++;
    });
  }
  const ms = Object.keys(M).map(Number).sort((a, b) => a - b);
  const po = ["실링지", "단상자", "라벨", "설명서", "블리스터"];
  const ps = po.filter((p) => P[p]).concat(Object.keys(P).filter((p) => !po.includes(p)).sort());
  const ts = Object.keys(D).sort((a, b) => D[b].t - D[a].t);
  return { M, P, D, T, ms, ps, ts };
}

export const prt = (b: number, q: number): string => (q ? ((b / q) * 100).toFixed(2) : "0.00");
export const REP_HEADERS = ["검사수량", "부적합수량", "부적합률(%)", "관리대상 로트(10%↑)", "미처리", "진행중", "완료"];

export function repRows<K extends string | number>(o: Record<K, Acc>, keys: K[], lab: (k: K) => string): (string | number)[][] {
  return keys.map((k) => {
    const x = o[k];
    return [lab(k), x.q, x.b, Number(prt(x.b, x.q)), x.n, x.s[0], x.s[1], x.s[2]];
  });
}
export function repTot(T: Acc): (string | number)[] {
  return ["합계", T.q, T.b, Number(prt(T.b, T.q)), T.n, T.s[0], T.s[1], T.s[2]];
}
