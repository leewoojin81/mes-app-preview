// PROD-11 주간업무보고 — 화면(클라이언트)과 서버(집계/Word 생성)가 함께 쓰는 상수·타입.
// 서버 전용 모듈(node:sqlite 등)을 끌어오지 않도록 weekly-report.ts에서 분리했다.

export const WEEKLY_YIELD_PROCESSES = [
  "Base 인쇄",
  "착색 인쇄",
  "정렬",
  "조립",
  "분리3",
  "외관검사",
  "실링",
  "입고대기",
  "마킹",
  "출하포장",
] as const;

// 주요공정 불량률 표의 대상 공정(서식: 분리 / 검사)과 표시할 불량유형 열.
export const WEEKLY_DEFECT_PROCESSES = [
  { process: "분리3", label: "분리" },
  { process: "외관검사", label: "검사" },
] as const;
// keys는 defect_type_status detail JSON 키(합산), title은 표 머리글.
export const WEEKLY_DEFECT_TABLE1 = [
  { title: "깨짐", keys: ["깨짐"] },
  { title: "안쪽깨짐", keys: ["안쪽깨짐"] },
  { title: "뜯김", keys: ["뜯낌"] },
  { title: "미분리", keys: ["미분리1", "미분리3"] },
  { title: "하몰드붙음", keys: ["하몰드붙음"] },
] as const;
export const WEEKLY_DEFECT_TABLE2 = [
  { group: "이물관리", title: "이물 1", keys: ["이물 1"] },
  { group: "이물관리", title: "이물 2", keys: ["이물 2"] },
  { group: "이물관리", title: "이물 3", keys: ["이물 3"] },
  { group: "인쇄", title: "색퍼짐", keys: ["색퍼짐"] },
  { group: "인쇄", title: "인쇄", keys: ["인쇄 不"] },
  { group: "인쇄", title: "색지렁이", keys: ["색,지렁이"] },
  { group: "인쇄", title: "Base이물", keys: ["BASE이물"] },
] as const;

export interface WeeklyPlanRow {
  /** "36 W" */
  weekLabel: string;
  /** "09/01~09/03" (월 경계로 자른 구간) */
  rangeLabel: string;
  /** 사출은 [상몰드, 하몰드], 인쇄/출하는 [단일] */
  plan: number[];
  /** 아직 시작 안 한 주차는 null */
  actual: (number | null)[];
  diff: (number | null)[];
  rate: (number | null)[];
}
export interface WeeklyPlanBlock {
  key: "injection" | "printing" | "shipping";
  title: string;
  /** 열 이름 — 사출: ["상몰드","하몰드"], 그 외: ["-"] */
  columns: string[];
  weeks: WeeklyPlanRow[];
  /** 월 합계 행(계획=월 전체, 실적=누계, 계획대비=주차별 차이의 합, 달성률=실적/월 계획) */
  month: { label: string; rangeLabel: string; plan: number[]; actual: number[]; diff: number[]; rate: (number | null)[] };
  /** "근무일(20일)수 대비 13일 경과_ 계획 진도율: 65.0%, 달성율 46.5%" 원재료 */
  totalWorkDays: number;
  elapsedWorkDays: number;
  progressRate: number | null;
  achievementRate: number | null;
  /** 이 라인의 일CAPA(PLAN-02)가 등록돼 있지 않으면 true — 계획/달성률을 계산할 수 없다 */
  capaMissing: boolean;
}

/** 출하공정 표(포장계획.JPG) — 주차별 기초계획(월)·포장 실적·계획대비실적·달성률을 팩수/수량 두 열로 */
export interface WeeklyPackagingRow {
  /** "40 주" 또는 월 합계 행의 "10 월" */
  weekLabel: string;
  /** "09/25~10/01" */
  rangeLabel: string;
  planPacks: number;
  planQty: number;
  /** 아직 시작 안 한 주차는 null */
  actualPacks: number | null;
  actualQty: number | null;
  diffPacks: number | null;
  diffQty: number | null;
  ratePacks: number | null;
  rateQty: number | null;
  /** 주차 행만: 그 주차 시작일(금요일, YYYY-MM-DD) — 기초계획 수정 저장의 키 */
  weekStart?: string;
  /** 기초계획을 직접 수정한 주차면 true (planPacks/planQty가 수정값) */
  planOverridden?: boolean;
  /** 계획정보(PLAN-03) 포장 일정에서 자동 계산한 원래 값 — 수정 화면 참고용 */
  autoPlanPacks?: number;
  autoPlanQty?: number;
}
export interface WeeklyPackagingBlock {
  weeks: WeeklyPackagingRow[];
  /** 월 합계 행(계획·실적은 그 달 1일~말일 날짜만, 계획대비는 주차별 차이의 합) */
  month: WeeklyPackagingRow;
  /** 1일~보고 주차 종료일까지의 기초계획 수량(PLAN-03 포장 일정) — 주간요약 원인분석 버튼 표시 판단용 */
  monthPlanQtyToDate: number;
}

export interface WeeklyPrintingRow {
  /** 수동인쇄기 / 자동인쇄기 / 합계 */
  label: string;
  /** 전주 — 그 주차 근무일 평균 가동대수(가동한 날이 없으면 null)와 생산량 합계 */
  prevAvgUnits: number | null;
  prevQty: number;
  /** 당주 요일별(금~목 7일) — 그날 생산이 없으면 units=null, qty=0 */
  units: (number | null)[];
  qty: number[];
  avgUnits: number | null;
  totalQty: number;
}
/** 서식의 "인쇄공정" 표(인쇄공정.JPG) — 수동/자동 인쇄기별 가동대수·생산수량 */
export interface WeeklyPrintingBlock {
  prevWeekLabel: string;
  prevWorkDays: number;
  weekLabel: string;
  dates: string[];
  rows: WeeklyPrintingRow[];
}

export interface WeeklyYieldRow {
  weekLabel: string; // "37 W"
  /** 사출(몰드) 수율 = (MOLD입고 − 사출→불량창고 이동 − MOLD입고의 불량창고 입고) ÷ MOLD입고, 입고 없으면 null */
  injection: number | null;
  /** WEEKLY_YIELD_PROCESSES 순서, 데이터 없으면 null */
  yields: (number | null)[];
  /** TTL = 사출 수율 × 렌즈 공정 수율의 곱(사출 데이터가 없으면 렌즈만) */
  total: number | null;
  /** 사출제외 TTL = 렌즈 공정 수율의 곱 */
  totalExInjection: number | null;
}

export interface WeeklyDefectRow {
  label: string; // 분리 / 검사
  workQty: number; // 작업량 = 양품 + 불량
  goodQty: number;
  badQty: number;
  yld: number | null;
  table1: (number | null)[]; // WEEKLY_DEFECT_TABLE1 순서, 불량률 = 유형수량 / 작업량
  table2: (number | null)[];
  /** 기타 = 위 두 표에 나오지 않는 불량유형들의 합 ÷ 작업량(유형 미분류 불량 제외) (2026-10-14 사용자 요청: 작업량·양품수·불량수처럼 병합 열) */
  etc: number | null;
  note: string; // 비고 예: "유실 0.37%" (없으면 "")
}

export interface WeeklyReportResult {
  weekNo: number;
  weekStart: string;
  weekEnd: string;
  reportDate: string; // 구간 종료 다음 월요일
  yearMonth: string;
  plan: WeeklyPlanBlock[];
  packaging: WeeklyPackagingBlock;
  printing: WeeklyPrintingBlock;
  yield: { current: WeeklyYieldRow; previous: WeeklyYieldRow; diffPct: number | null; diffPctExInjection: number | null };
  defect: WeeklyDefectRow[];
}


/**
 * 수율 문장(당주 / 전주 / 전주 比)의 소수 자릿수. 기본은 소수 첫째 자리인데, 반올림한 당주·전주 값의 차이가
 * 반올림한 차이와 어긋나 보이면(예: 83.6% · 87.4% 인데 3.7% 감소) 혼동을 줄이기 위해 둘째 자리까지 보여준다
 * (2026-10-16 사용자 요청). 값은 0~1 비율이다.
 */
export function yieldDigits(cur: number | null, prev: number | null, diff: number | null): 1 | 2 {
  if (cur == null || prev == null || diff == null) return 1;
  return Math.round(cur * 1000) - Math.round(prev * 1000) === Math.round(diff * 1000) ? 1 : 2;
}
