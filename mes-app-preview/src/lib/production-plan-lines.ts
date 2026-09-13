import type { DatabaseSync } from "node:sqlite";

// 계획정보(PLAN-02) "공정별 월 CAPA 및 근무계획" — 첨부 생산계획 엑셀의 "라인별" 10개
// 구분(사출_상/사출_하/착색/조립/분리/외관/실링/마킹/출하/간접직)은 작업자등록(BASE-09)
// workers.work_group(9개, 조립분리를 안 나누고 인쇄를 착색과 다른 이름으로 씀)과 안
// 맞아 대응이 안 된다. 대신 workers.process_code(BASE-04 세부공정코드, work_group보다
// 한 단계 더 세분화된 값)로 나누면 실제 인원수가 훨씬 정확히 맞는다(2026-09-13 확인 —
// 조립4명·분리3명·출하14명·OEM창고4명·세정2명·디자인2명 등 첨부 엑셀 수치와 거의 정확히
// 일치, 사용자가 이 방식으로 확정). "사출_상"만 지금 있는 사출(P100)을 그대로 쓰고
// "사출_하"는 대응되는 세부공정이 아직 없어 항상 0명/빈 라인으로 둔다(라인이 실제
// 생기면 processCodes만 채우면 됨).
export interface ProductionLineDef {
  key: string;
  label: string;
  processCodes: string[];
  /** true면 "공정별 계획(CAPA)" 개념 자체가 없다 — 인원만 집계하고, 소속 인원을
   *  process_code별로 묶어 "비고"에 텍스트로 보여준다. */
  isIndirect?: boolean;
}

export const PRODUCTION_LINES: ProductionLineDef[] = [
  { key: "injection_upper", label: "사출_상", processCodes: ["P100"] },
  { key: "injection_lower", label: "사출_하", processCodes: [] },
  { key: "coloring", label: "착색", processCodes: ["P150", "P200", "P210", "P220", "P230", "P240"] },
  { key: "assembly", label: "조립", processCodes: ["P300", "P310"] },
  { key: "separation", label: "분리", processCodes: ["P320", "P330", "P340", "P350", "P355"] },
  { key: "appearance", label: "외관", processCodes: ["P356", "P360", "P361"] },
  { key: "sealing", label: "실링", processCodes: ["P370", "P380"] },
  { key: "marking", label: "마킹", processCodes: ["P385", "P390", "P400"] },
  { key: "shipping", label: "출하", processCodes: ["P410"] },
  {
    key: "indirect",
    label: "간접직",
    processCodes: ["P500", "P501", "P502", "P503", "P504", "P505", "P510"],
    isIndirect: true,
  },
];

// 간접직 "비고"에 쓰는 표시 라벨 — 대부분 공정명을 그대로 쓰지만, 회사에서 부르는
// 이름이 공정명과 다른 것만 예외로 바꾼다(2026-09-13 사용자 제공 예시 "QC2, 생산지원3,
// 세정2, OEM창고4, 디자인2"를 실제 인원수로 역산해 확정 — 공정품질(P505)은 "QC"로,
// 생산기술(P504)·기타(P510)는 둘 다 "생산지원"으로 묶어 부른다).
export const INDIRECT_LABEL_OVERRIDE: Record<string, string> = {
  P505: "QC",
  P504: "생산지원",
  P510: "생산지원",
};

// 근무시간(Day) — 조별로 실제 근로시간이 달라 라인마다 다르게 계산하려면 그 라인에
// 어느 조가 몇 명인지까지 가중평균해야 하는데 지나치게 복잡하고, 첨부 엑셀도 전부
// 8.00hr 고정으로만 되어 있어(2026-09-13 사용자 확인) 그대로 고정값을 쓴다.
export const HOURS_PER_DAY = 8;

export interface LineCapaRow {
  key: string;
  label: string;
  isIndirect: boolean;
  headcount: number;
  hoursPerDay: number;
  workDays: number;
  dailyCapa: number | null;
  monthlyCapa: number | null;
  uph: number | null;
  /** 사용자가 직접 입력해 저장한 비고(없으면 null). */
  remark: string | null;
  /** 값을 비워뒀을 때 보여줄 기본 비고 — 간접직 소속 인원 자동 집계 텍스트뿐, 나머지
   *  라인은 항상 null. */
  defaultRemark: string | null;
}

export interface LineCapaResult {
  yearMonth: string;
  rows: LineCapaRow[];
  totals: {
    headcount: number;
    dailyCapa: number | null;
    monthlyCapa: number | null;
    uph: number | null;
  };
}

// db.ts의 SCHEMA_SQL은 getDb()가 프로세스에서 처음 DB 커넥션을 만들 때 딱 한 번만
// 실행된다 — 이미 떠 있는 서버 프로세스는 이 테이블이 새로 추가된 뒤에도 재시작 전까지
// 모른다. 매 호출마다 여기서도 한 번 더 보장해 재시작 없이도 바로 동작하게 한다
// (CREATE TABLE IF NOT EXISTS라 이미 있으면 아무 영향 없음).
function ensureTable(db: DatabaseSync): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS line_capa_plan (
      year_month TEXT NOT NULL,
      line_key TEXT NOT NULL,
      daily_capa REAL,
      remark TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_by TEXT,
      PRIMARY KEY (year_month, line_key)
    )`
  );
  // 테이블이 remark 없이 먼저 만들어진 상태로 이미 떠 있는 서버 프로세스가 있을 수
  // 있어(2026-09-13 비고 입력 기능 추가), 재시작 없이도 바로 동작하도록 여기서도
  // 한 번 더 보장한다.
  const cols = db.prepare("PRAGMA table_info(line_capa_plan)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "remark")) {
    db.exec("ALTER TABLE line_capa_plan ADD COLUMN remark TEXT");
  }
}

function monthRange(yearMonth: string): { start: string; end: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  const start = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

// 근무일수(Month) — 생산캘린더(BASE-08)에서 그 달 중 work_yn='Y'인 날짜 수를 그대로 센다.
function countWorkDays(db: DatabaseSync, yearMonth: string): number {
  const { start, end } = monthRange(yearMonth);
  const row = db
    .prepare(
      `SELECT COUNT(*) c FROM production_calendar WHERE cal_date BETWEEN ? AND ? AND work_yn = 'Y'`
    )
    .get(start, end) as { c: number };
  return row.c;
}

/** PATCH 라우트가 저장 전 테이블 존재를 보장하기 위해 export한다(ensureTable 자체는
 *  파일 내부 전용 헬퍼로 두고 재사용). */
export function ensureLineCapaPlanTable(db: DatabaseSync): void {
  ensureTable(db);
}

export function computeLineCapaPlan(db: DatabaseSync, yearMonth: string): LineCapaResult {
  ensureTable(db);
  const workDays = countWorkDays(db, yearMonth);

  const headcountRows = db
    .prepare(
      `SELECT process_code, COUNT(*) c FROM workers
       WHERE use_yn = 'Y' AND status = '정상' AND process_code IS NOT NULL
       GROUP BY process_code`
    )
    .all() as { process_code: string; c: number }[];
  const headcountByProcess = new Map(headcountRows.map((r) => [r.process_code, r.c]));

  const processNameRows = db.prepare(`SELECT process_code, process_name FROM processes`).all() as {
    process_code: string;
    process_name: string;
  }[];
  const processNameByCode = new Map(processNameRows.map((r) => [r.process_code, r.process_name]));

  const capaRows = db
    .prepare(`SELECT line_key, daily_capa, remark FROM line_capa_plan WHERE year_month = ?`)
    .all(yearMonth) as { line_key: string; daily_capa: number | null; remark: string | null }[];
  const capaByLine = new Map(capaRows.map((r) => [r.line_key, r.daily_capa]));
  const remarkByLine = new Map(capaRows.map((r) => [r.line_key, r.remark]));

  const rows: LineCapaRow[] = PRODUCTION_LINES.map((line) => {
    const headcount = line.processCodes.reduce((sum, code) => sum + (headcountByProcess.get(code) ?? 0), 0);

    let defaultRemark: string | null = null;
    if (line.isIndirect) {
      const parts = new Map<string, number>();
      for (const code of line.processCodes) {
        const c = headcountByProcess.get(code) ?? 0;
        if (c === 0) continue;
        const label = INDIRECT_LABEL_OVERRIDE[code] ?? processNameByCode.get(code) ?? code;
        parts.set(label, (parts.get(label) ?? 0) + c);
      }
      defaultRemark =
        parts.size > 0
          ? Array.from(parts.entries())
              .map(([label, c]) => `${label}${c}`)
              .join(", ")
          : null;
    }

    const dailyCapa = line.isIndirect ? null : (capaByLine.get(line.key) ?? null);
    const monthlyCapa = dailyCapa != null ? dailyCapa * workDays : null;
    const uph = dailyCapa != null && headcount > 0 ? dailyCapa / (headcount * HOURS_PER_DAY) : null;
    const remark = remarkByLine.get(line.key) ?? null;

    return {
      key: line.key,
      label: line.label,
      isIndirect: !!line.isIndirect,
      headcount,
      hoursPerDay: HOURS_PER_DAY,
      workDays,
      dailyCapa,
      monthlyCapa,
      uph,
      remark,
      defaultRemark,
    };
  });

  // 합계 행의 DAY/MONTH는 전체 라인 일CAPA를 그냥 더한 값이 아니라 출하(shipping) 기준
  // 값을 그대로 가져온다 — 사출→...→출하로 이어지는 한 공정 흐름이라 각 라인의 CAPA가
  // 서로 다른 반제품 단계를 가리켜서 단순 합산이 의미가 없고, 최종 출하량만이 실제 전체
  // 생산량을 뜻한다(2026-09-13 사용자 요청). 생산성(UPH)도 그 출하 월CAPA를 전체
  // 인원×근무시간×근무일수(그 달 총 가용 근로시간)로 나눠 공장 전체 효율로 다시 계산한다.
  const totalHeadcount = rows.reduce((sum, r) => sum + r.headcount, 0);
  const shippingRow = rows.find((r) => r.key === "shipping");
  const totalDailyCapa = shippingRow?.dailyCapa ?? null;
  const totalMonthlyCapa = shippingRow?.monthlyCapa ?? null;
  const totalUph =
    totalMonthlyCapa != null && totalHeadcount > 0 && workDays > 0
      ? totalMonthlyCapa / (totalHeadcount * HOURS_PER_DAY * workDays)
      : null;

  return {
    yearMonth,
    rows,
    totals: {
      headcount: totalHeadcount,
      dailyCapa: totalDailyCapa,
      monthlyCapa: totalMonthlyCapa,
      uph: totalUph,
    },
  };
}
