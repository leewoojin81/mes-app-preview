// 재고 수불 원장(INV-06)/재고 대사(INV-07) 공용 상수·타입 — 서버/클라이언트 양쪽에서 import한다.
export const STOCK_TX_TYPES = ["입고", "출고", "이동", "조정"] as const;
export type StockTxType = (typeof STOCK_TX_TYPES)[number];

// 근거 — 자동 반영은 구매입고/MOLD입고/창고이동/출하, 나머지는 수동 등록용 제안값(자유 입력도 허용).
export const STOCK_REASON_OPTIONS = [
  "구매입고",
  "MOLD입고",
  "생산투입",
  "생산입고",
  "출하",
  "창고이동",
  "재고조정",
  "기초재고",
] as const;

export interface StockLedgerRow {
  id: number;
  tx_at: string;
  item_code: string;
  item_name: string | null;
  lot_no: string;
  warehouse: string;
  tx_type: StockTxType;
  qty: number;
  reason: string;
  ref_no: string | null;
  memo: string | null;
  created_by: string | null;
}

export interface StockBalanceRow {
  item_code: string;
  item_name: string | null;
  lot_no: string;
  warehouse: string;
  qty: number;
}

export interface StockBaseline {
  id: number;
  base_date: string;
  snapshot_uploaded_at: string | null;
  row_count: number;
  total_qty: number;
  created_by: string | null;
  created_at: string;
}

export type ReconcileKind = "diff" | "erp_only" | "mes_only" | "match";

export interface ReconcileRow {
  item_code: string;
  item_name: string | null;
  lot_no: string;
  warehouse: string;
  erp_qty: number;
  mes_qty: number;
  diff: number; // mes - erp
  kind: ReconcileKind;
}

export interface ReconcileSummary {
  keys: number;
  match: number;
  diff: number;
  erp_only: number;
  mes_only: number;
  erp_total: number;
  mes_total: number;
}
