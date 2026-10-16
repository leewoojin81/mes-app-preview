// PROD-12 월간업무보고 — 화면(클라이언트)과 서버(집계/Word 생성)가 함께 쓰는 상수·타입.
// 서버 전용 모듈(node:sqlite 등)을 끌어오지 않도록 monthly-report.ts에서 분리했다.
import type { WeeklyDefectRow } from "./weekly-report-shared";

/** 1. 공정별 생산실적 및 생산성 차트의 공정 — 코드는 일일작업현황(PROD-10)·근무시간(PSN-01)의 공정코드(BASE-04) */
export const MONTHLY_PRODUCTION_PROCESSES = [
  { label: "사출", code: "P100" },
  { label: "착색", code: "P220" },
  { label: "정렬", code: "P240" },
  { label: "조립", code: "P300" },
  { label: "분리", code: "P340" },
  { label: "외관", code: "P360" },
  { label: "실링", code: "P370" },
  { label: "마킹", code: "P400" },
  { label: "출하", code: "P410" },
] as const;

export interface MonthlyProductionRow {
  label: string;
  /** 생산량(개) — 사출은 MOLD입고(상·하몰드)에서 불량을 뺀 렌즈 환산 수량, 나머지는 일일작업현황 양품수량 */
  qty: number;
  /** 근무시간(h) — PSN-01 근무시간 합계(지원 반영, 생산현황(MGMT-05) 생산성과 같은 기준) */
  hours: number;
  /** 생산성 = 생산량(K천대) ÷ 근무시간 — 근무시간이 없으면 null */
  productivity: number | null;
}

export interface MonthlyPrintingRow {
  /** 수동인쇄기 / 자동인쇄기 / 합계 */
  label: string;
  /** 주차별(월 경계로 자른 구간) 평균 가동대수 — 그 주차에 생산이 없으면 null */
  units: (number | null)[];
  qty: number[];
  avgUnits: number | null;
  totalQty: number;
}
export interface MonthlyPrintingBlock {
  /** 생산캘린더 근무일수(work_yn='Y') */
  workDays: number;
  /** "36 W" */
  weekLabels: string[];
  /** "09/01~09/03" (월 경계로 자른 구간) */
  rangeLabels: string[];
  rows: MonthlyPrintingRow[];
}

export interface MonthlyYieldRow {
  /** "09월" */
  monthLabel: string;
  injection: number | null;
  /** WEEKLY_YIELD_PROCESSES 순서 */
  yields: (number | null)[];
  total: number | null;
  totalExInjection: number | null;
}
export interface MonthlyTrendPoint {
  label: string;
  kind: "quarter" | "month";
  total: number | null;
  exInjection: number | null;
}

export interface MonthlyReportResult {
  /** "2026-09" */
  yearMonth: string;
  monthNo: number;
  dateFrom: string;
  dateTo: string;
  /** 보고일 = 말일 다음 날 */
  reportDate: string;
  production: MonthlyProductionRow[];
  printing: MonthlyPrintingBlock;
  yield: { previous: MonthlyYieldRow; current: MonthlyYieldRow; trend: MonthlyTrendPoint[] };
  defect: WeeklyDefectRow[];
}
