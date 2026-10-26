// 마킹출하공정(PROC-06) 오더양식 — 엑셀 "1 오더양식(ANW) 형명추가ver.xlsx"(ANW 본표 + ANW_소/중 박스 라벨 시트)를 옮긴 계산.
// 화면과 서버가 같이 쓴다. 엑셀 칸 이름은 괄호로 적었다.

export interface OrderFormLine {
  item_code: string;
  power: number | null;
  /** 샘플(D) — 수주 샘플구분이 Sample인 줄 수량(렌즈 수) */
  sample: number;
  /** 오더(E) — 일반 줄 수량(렌즈 수) */
  order: number;
  /** JAN — 품목정보(BASE-01) "JAN 코드" */
  jan: string;
}

export interface OrderFormLabel {
  code: string;
  name: string;
  spec: string;
}

export interface OrderFormModel {
  rep_item: string;
  /** 모델(D46) — 대표품목 앞 5자리 */
  model: string;
  item_name: string;
  /** 박스 라벨 브랜드·Color 기본값(품목군·품명에서 추정 — 화면에서 고쳐 저장) */
  brand_default: string;
  color_default: string;
  cycle: string;
  /** 형명(D37) */
  model_name: string;
  bc: number | null;
  dia: number | null;
  /** 입수(L47) — 포장단위수량 */
  pack_unit: number | null;
  /** 품목정보 1 Box / 2 Box 수량 — 박스당 SET 기본값 */
  box1: number | null;
  box2: number | null;
  /** BOM 라벨 자재(BIL, 품명에 "라벨") — 단상자 라벨이 앞 */
  labels: OrderFormLabel[];
  /** 출하LOT·제조일자·사용기한 — SALES-04 출하LOT 발행 값(원본). 미발행이면 라벨일정(PROC-06) 값으로 임시 표시 */
  ship_lot: string;
  prod_date: string;
  /** 사용기한 — SALES-04 표기(년월일 YYYY-MM-DD / 년월 YYYY-MM) 그대로 */
  expiry: string;
  /** 제조일자 표기 — SALES-04 date_fmt(년월이면 제조도 YYYY-MM) */
  prod_text: string;
  issued: boolean;
  /** 라벨일정 작업자 */
  worker: string;
  /** 형명 유효기간(년) — 공통정보(BASE-10) */
  shelf_years: number | null;
  lines: OrderFormLine[];
}

export type BoxKind = "소" | "중";

export interface OrderFormModelInput {
  brand?: string;
  color?: string;
  box_kind?: BoxKind;
  box_rows?: 1 | 2;
  per_box?: number;
}

export interface OrderFormInput {
  /** 일련번호(D40) */
  serial?: string;
  /** 라벨 사용량(M48) — 수량이 있는 도수마다 더하는 라벨 수, 기본 8 */
  label_use?: number;
  memo?: string;
  models?: Record<string, OrderFormModelInput>;
  /** 품목코드별 불량(S) · 추가 불량(T) */
  defects?: Record<string, { s?: number; t?: number }>;
}

export interface OrderFormData {
  mo_no: string;
  so_nos: string[];
  customer: string;
  models: OrderFormModel[];
  input: OrderFormInput;
  updated_at: string;
  updated_by: string;
}

export interface OrderFormMo {
  mo_no: string;
  so_nos: string;
  brand: string;
  reps: string;
  qty: number;
  ship_lot: string;
  order_date: string;
  saved: boolean;
}

export const DEFAULT_LABEL_USE = 8;
/** 소박스는 카톤당 6개, 중박스는 2개(엑셀 ANW_소 / ANW_중의 카톤 번호 식) */
export const BOXES_PER_CARTON: Record<BoxKind, number> = { 소: 6, 중: 2 };

/** 품목코드 끝 4자리 → 도수(0425 → -4.25) */
export function powerOf(itemCode: string): number | null {
  const m = /-(\d{4})$/.exec(itemCode);
  return m ? -Number(m[1]) / 100 : null;
}

export function powerText(p: number | null): string {
  if (p == null) return "-";
  return p === 0 ? "0.00" : p.toFixed(2);
}

/** LOT 도수 2자리(Q) — ROUNDDOWN(|도수|×10): 0→00, 0.25→02, 0.5→05, 0.75→07, 10→A0, 그 외 그대로(-4.25 → 42) */
export function lotPowerCode(p: number | null): string {
  if (p == null) return "";
  const n = Math.floor(Math.round(Math.abs(p) * 1000) / 100);
  if (n === 0) return "00";
  if (n === 2) return "02";
  if (n === 5) return "05";
  if (n === 7) return "07";
  if (n === 100) return "A0";
  return String(n);
}

/** QR 도수코드 3자리 — 200 + |도수|÷0.25 (0.00→200, -0.75→203, -6.50→226) */
export function qrPowerCode(p: number | null): string {
  if (p == null) return "";
  return String(200 + Math.round(Math.abs(p) * 4));
}

/** QR BC 코드 — (B.C − 5) ÷ 0.05 (8.6 → 72) */
export function bcCode(bc: number | null): string {
  if (bc == null) return "";
  return String(Math.round((bc - 5) / 0.05)).padStart(2, "0");
}

/** QR DIA 코드 — (DIA − 7) × 10 (14.0 → 70, 14.2 → 72, 14.5 → 75) */
export function diaCode(dia: number | null): string {
  if (dia == null) return "";
  return String(Math.round((dia - 7) * 10)).padStart(2, "0");
}

/** 2026-10-15 → 261015, 2031-09 → 3109 (제조 D38 · 유효 D39) */
export const yymmdd = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10) : /^\d{4}-\d{2}$/.test(iso) ? iso.slice(2, 4) + iso.slice(5, 7) : "";
/** 2026-10-15 → 2026/10 (제조 H · 유효기한 I) */
export const yyyymm = (iso: string) => (/^\d{4}-\d{2}/.test(iso) ? `${iso.slice(0, 4)}/${iso.slice(5, 7)}` : "");

/** 여유(N) — SET 수에 따라 0 / 10 / 15 / 20 / 25 / 30 / 35 (엑셀 식의 10000 초과 조건은 식 오류로 30이 되던 것을 35로 바로잡음) */
export function spareOf(set: number): number {
  if (set > 10000) return 35;
  if (set > 8000) return 30;
  if (set > 5000) return 25;
  if (set > 3000) return 20;
  if (set > 1000) return 15;
  if (set > 0) return 10;
  return 0;
}

export interface OrderFormRow extends OrderFormLine {
  /** SET(G) = (샘플 + 오더) ÷ 입수 */
  set: number;
  /** 여유(N) */
  spare: number;
  /** 불출(F) = SET + 여유 */
  issue: number;
  /** 라벨 사용량(M) */
  use: number;
  /** 소진(O) = 불출 + 라벨 사용량 */
  consume: number;
  /** LOT(L) = 출하LOT + 모델 + 도수 2자리 */
  lot_code: string;
  /** QR(K) = JAN + 00 + 유효 YYMM + 출하LOT + 모델 + 도수 2자리 + BC + DIA + 도수코드 3자리 */
  qr: string;
  defect: number;
  defect_add: number;
}

export interface OrderFormBlock {
  model: OrderFormModel;
  expiry: string;
  rows: OrderFormRow[];
  total: { sample: number; order: number; set: number; spare: number; issue: number; use: number; consume: number; defect: number };
}

export function buildBlock(m: OrderFormModel, input: OrderFormInput): OrderFormBlock {
  const unit = m.pack_unit && m.pack_unit > 0 ? m.pack_unit : 1;
  const labelUse = input.label_use ?? DEFAULT_LABEL_USE;
  const expiry = m.expiry; // SALES-04 출하LOT 탭이 정한 사용기한
  const qrHead = `00${yymmdd(expiry).slice(0, 4)}${m.ship_lot}${m.model}`;
  const qrTail = `${bcCode(m.bc)}${diaCode(m.dia)}`;
  const rows = m.lines.map((l): OrderFormRow => {
    const qty = l.sample + l.order;
    const set = qty / unit;
    const spare = spareOf(set);
    const issue = set + spare;
    const use = qty > 0 ? labelUse : 0;
    const pc = lotPowerCode(l.power);
    const d = input.defects?.[l.item_code];
    return {
      ...l,
      set,
      spare,
      issue,
      use,
      consume: issue + use,
      lot_code: m.ship_lot ? `${m.ship_lot}${m.model}${pc}` : "",
      qr: l.jan && m.ship_lot && expiry ? `${l.jan}${qrHead}${pc}${qrTail}${qrPowerCode(l.power)}` : "",
      defect: d?.s ?? 0,
      defect_add: d?.t ?? 0,
    };
  });
  const sum = (f: (r: OrderFormRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  return {
    model: m,
    expiry,
    rows,
    total: {
      sample: sum((r) => r.sample),
      order: sum((r) => r.order),
      set: sum((r) => r.set),
      spare: sum((r) => r.spare),
      issue: sum((r) => r.issue),
      use: sum((r) => r.use),
      consume: sum((r) => r.consume),
      defect: sum((r) => r.defect + r.defect_add),
    },
  };
}

// ---- 박스 라벨(ANW_소 · ANW_소2행 · ANW_중 · ANW_중2행) ----

export interface BoxLine {
  /** 도수 문자열 또는 "SAMPLE" */
  label: string;
  qty: number;
}

export interface Box {
  carton: number;
  box: number;
  lines: BoxLine[];
}

export function modelBoxSettings(m: OrderFormModel, input: OrderFormInput): Required<Pick<OrderFormModelInput, "box_kind" | "box_rows" | "per_box">> {
  const s = input.models?.[m.rep_item] ?? {};
  const kind: BoxKind = s.box_kind ?? "중";
  const def = (kind === "중" ? m.box2 : m.box1) ?? 0;
  return { box_kind: kind, box_rows: s.box_rows ?? 2, per_box: s.per_box && s.per_box > 0 ? s.per_box : def };
}

/**
 * 박스 나누기 — 도수 순서대로 오더 SET(오더 ÷ 입수, 샘플 제외)을 박스당 SET만큼 채우고, 샘플 SET 합계의 절반은 맨 뒤 "SAMPLE"로.
 * 2행은 한 박스에 도수 2개까지(앞 도수가 남으면 다음 도수로 채움), 1행은 도수가 바뀌면 새 박스.
 * 카톤 번호 = 박스 순번 ÷ 카톤당 박스(소 6, 중 2), cartonStart부터.
 */
export function buildBoxes(block: OrderFormBlock, s: { box_kind: BoxKind; box_rows: 1 | 2; per_box: number }, cartonStart = 1): Box[] {
  const unit = block.model.pack_unit && block.model.pack_unit > 0 ? block.model.pack_unit : 1;
  const per = s.per_box;
  if (!(per > 0)) return [];
  const items: BoxLine[] = block.rows.filter((r) => r.order > 0).map((r) => ({ label: powerText(r.power), qty: r.order / unit }));
  // 샘플은 도수별 2팩 중 1팩만 출고 마지막 박스에, 남는 1팩은 영업팀으로(출하요청서 포장시 유의사항) → 샘플 SET의 절반
  const sampleSet = block.rows.reduce((t, r) => t + r.sample, 0) / unit / 2;
  if (sampleSet > 0) items.push({ label: "SAMPLE", qty: sampleSet });
  const perCarton = BOXES_PER_CARTON[s.box_kind];
  const boxes: Box[] = [];
  let cur: BoxLine[] | null = null;
  let left = 0;
  const open = () => {
    const n = boxes.length;
    cur = [];
    left = per;
    boxes.push({ carton: cartonStart + Math.floor(n / perCarton), box: (n % perCarton) + 1, lines: cur });
  };
  for (const it of items) {
    let r = Math.round(it.qty * 1000) / 1000;
    while (r > 0) {
      if (!cur || left <= 0 || (cur as BoxLine[]).length >= s.box_rows) open();
      const take = Math.min(r, left);
      (cur as unknown as BoxLine[]).push({ label: it.label, qty: take });
      left -= take;
      r = Math.round((r - take) * 1000) / 1000;
    }
    if (s.box_rows === 1) cur = null; // 1행: 도수가 바뀌면 새 박스
  }
  return boxes;
}

/** 품명에서 브랜드·주기 낱말을 빼 Color 기본값을 만든다("CANNA ROZE 1DAY BEIGE BROWN" → "BEIGE BROWN") */
export function guessColor(itemName: string, brandGroup: string, cycle: string): string {
  const drop = new Set(
    [...brandGroup.split(/[_\s]+/), cycle, "1DAY", "1MONTH", "MONTHLY", "2WEEK", "ONEDAY", "ONE", "DAY"].map((w) => w.trim().toUpperCase()).filter(Boolean)
  );
  const words = itemName.split(/[\s/]+/).filter(Boolean);
  const rest = words.filter((w) => !drop.has(w.toUpperCase()));
  return (rest.length ? rest : words).join(" ");
}

/** 품목군 → 박스 라벨 브랜드 기본값("Canna Roze_JPN" → "CANNAROZE") */
export function guessBrand(brandGroup: string): string {
  return brandGroup.split("_")[0].replace(/\s+/g, "").toUpperCase();
}
