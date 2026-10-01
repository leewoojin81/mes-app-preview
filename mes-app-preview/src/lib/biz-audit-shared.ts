// 비즈 대사(PSN-06 비즈 탭) 화면과 서버가 함께 쓰는 타입·상수 — 서버 전용 모듈을 끌어오지 않도록
// biz-audit.ts에서 분리했다.

export const BIZ_AUDIT_TOLERANCE_MIN = 10;
export type BizAuditStatus = "일치" | "불일치" | "비즈만" | "MES만";
export type BizAuditItemKey = "normal" | "extension" | "late" | "early_leave";
export const BIZ_AUDIT_ITEM_KEYS: BizAuditItemKey[] = ["normal", "extension", "late", "early_leave"];
export const BIZ_AUDIT_ITEM_LABELS: Record<BizAuditItemKey, string> = {
  normal: "정근(특근 포함)",
  extension: "연장(특연 포함)",
  late: "지각",
  early_leave: "조퇴",
};

export interface BizAuditItem {
  /** 분 */
  biz: number;
  mes: number;
  diff: number;
  mismatch: boolean;
}

export interface BizAuditRow {
  employee_no: string;
  biz_no: string;
  worker_name: string;
  work_group: string | null;
  dept: string | null;
  work_date: string;
  shift: string | null;
  in_time: string | null;
  out_time: string | null;
  leave_type: string | null;
  items: Record<BizAuditItemKey, BizAuditItem>;
  status: BizAuditStatus;
  causes: string[];
  note: string | null;
}

export interface BizAuditSummary {
  comparedRows: number;
  matchRows: number;
  mismatchRows: number;
  bizOnlyRows: number;
  mesOnlyRows: number;
  /** 일치 ÷ 전체 비교 행 */
  matchRate: number | null;
  byItem: Record<BizAuditItemKey, number>;
  byCause: { cause: string; count: number }[];
  /** 비즈에 아직 반영되지 않은 최근 일자라 비교에서 뺀 날짜 */
  excludedDates: { date: string; bizRows: number; mesRows: number }[];
  /** 작업자등록에 비즈 사번이 없어 MES와 연결할 수 없는 비즈 인원(사무직 등) */
  unmatchedPersons: { biz_no: string; name: string | null; dept: string | null; days: number }[];
  bizFrom: string | null;
  bizTo: string | null;
}

export interface BizAuditResult {
  dateFrom: string;
  dateTo: string;
  rows: BizAuditRow[];
  summary: BizAuditSummary;
}

