// 마킹출하공정(PROC-06) 라벨일정 — 화면/서버 공용 타입·선택지

export const LABEL_INPUT_FIELDS = [
  "work_date",
  "worker",
  "ship_lot",
  "prod_date",
  "label_type",
  "progress",
  "packing",
  "note",
] as const;

export type LabelInputField = (typeof LABEL_INPUT_FIELDS)[number];
export type LabelScheduleInput = Record<LabelInputField, string>;

export type LabelScheduleRow = LabelScheduleInput & {
  rank: number | null; // 생산순위지정(PLAN-01) 작업순서 기준 순위
  mo_no: string;
  rep_item: string;
  so_no: string;
  order_date: string;
  so_status: string;
  customer: string; // 거래처정보(BASE-06) 약칭 — 미등록이면 ""
  customer_name: string;
  brand: string;
  model: string;
  cycle: string;
  order_qty: number;
  pack_unit: number | null;
  label_qty: number | null;
  model_name: string;
  shelf_years: number | null;
  bom_label: string; // 라벨종류 — BOM정보의 라벨 자재명("단상자 라벨", "측면 라벨 + 도수 라벨" …), 없으면 "없음"
  expiry_date: string;
  updated_at: string;
  updated_by: string;
};

// 엑셀 "진행여부" 시트의 선택지
export const PROGRESS_OPTIONS = ["진행중", "완료", "Tray 완료", "UDI 완료"];
export const DONE_PROGRESS = new Set(["완료", "Tray 완료", "UDI 완료"]);

// 유통기한 = 생산일자 + n년 − 1일 (엑셀 EDATE(생산일자, 년*12)-1 — 말일 넘침은 그 달 말일로 맞춘다)
export function expiryDate(prodDate: string, years: number | null): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(prodDate) || !years) return "";
  const [y, m, d] = prodDate.split("-").map(Number);
  const ty = y + years;
  const last = new Date(Date.UTC(ty, m, 0)).getUTCDate();
  const t = new Date(Date.UTC(ty, m - 1, Math.min(d, last)));
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

// 화면 열 정의 — 표시 항목·열 순서(PLAN-04식, 계정별 저장)와 엑셀 다운로드가 함께 쓴다
export type LabelColKey =
  | "rank" | "so_no" | "mo_no" | "customer" | "brand" | "rep_item" | "model" | "cycle" | "order_qty" | "pack_unit"
  | "label_qty" | "model_name" | "shelf" | "work_date" | "worker" | "ship_lot" | "prod_date" | "expiry"
  | "label_type" | "progress" | "packing" | "note";
export const LABEL_COLS: { key: LabelColKey; label: string; input?: boolean }[] = [
  { key: "rank", label: "순위" },
  { key: "so_no", label: "수주번호" },
  { key: "mo_no", label: "MO번호" },
  { key: "customer", label: "고객사" },
  { key: "brand", label: "브랜드명" },
  { key: "rep_item", label: "대표품목" },
  { key: "model", label: "모델명" },
  { key: "cycle", label: "주기" },
  { key: "order_qty", label: "수주량" },
  { key: "pack_unit", label: "포장단위" },
  { key: "label_qty", label: "라벨수량" },
  { key: "model_name", label: "형명" },
  { key: "shelf", label: "유효기간" },
  { key: "work_date", label: "작업일자", input: true },
  { key: "worker", label: "작업자", input: true },
  { key: "ship_lot", label: "출하LOT", input: true },
  { key: "prod_date", label: "생산일자", input: true },
  { key: "expiry", label: "유통기한" },
  { key: "label_type", label: "라벨종류" },
  { key: "progress", label: "진행사항", input: true },
  { key: "packing", label: "패킹LIST", input: true },
  { key: "note", label: "비고", input: true },
];

export type ProgressFilter = "all" | "open" | "done";

// 화면에 보이는 순서·필터 — 진행사항이 완료(완료·Tray 완료·UDI 완료)된 줄을 위로(그 안에서는 PLAN-01 작업순서 유지),
// 진행 필터(전체/미완료/완료)와 검색어를 건다
export function filterLabelRows(rows: LabelScheduleRow[], pf: ProgressFilter, q: string): LabelScheduleRow[] {
  const kw = q.trim().toLowerCase();
  const sorted = [...rows.filter((r) => DONE_PROGRESS.has(r.progress)), ...rows.filter((r) => !DONE_PROGRESS.has(r.progress))];
  return sorted.filter((r) => {
    const done = DONE_PROGRESS.has(r.progress);
    if (pf === "open" && done) return false;
    if (pf === "done" && !done) return false;
    if (!kw) return true;
    return [r.mo_no, r.so_no, r.customer, r.customer_name, r.brand, r.rep_item, r.model_name, r.worker, r.ship_lot].some((v) =>
      v.toLowerCase().includes(kw)
    );
  });
}

// 엑셀 셀 값 — 숫자는 숫자로, 화면에서 비어 보이는 값은 빈 칸으로(라벨종류는 BOM정보의 라벨 자재명)
export function labelCellValue(r: LabelScheduleRow, k: LabelColKey): string | number | null {
  switch (k) {
    case "rank": return r.rank;
    case "customer": return r.customer || r.customer_name;
    case "order_qty": return r.order_qty;
    case "pack_unit": return r.pack_unit;
    case "label_qty": return r.label_qty == null ? null : Math.round(r.label_qty * 10) / 10;
    case "shelf": return r.shelf_years;
    case "expiry": return r.expiry_date;
    case "label_type": return r.bom_label;
    case "progress": return r.progress || "미진행";
    default: return r[k] ?? "";
  }
}
