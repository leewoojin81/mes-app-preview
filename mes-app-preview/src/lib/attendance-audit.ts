import type { DatabaseSync } from "node:sqlite";
import { BIZ_NAME_PREFIXES, convertBizEmployeeNo } from "@/lib/biz-import";
import { FIXED_OVERTIME_APPLICATION_HOURS } from "@/lib/overtime-application";
import { dateRange } from "@/lib/work-hours-lookup";
import { ENTITY_TYPE_WORKER, fetchFieldHistoryMap, resolveFieldAsOf } from "@/lib/master-data-history";
import {
  deriveEarlyLeaveHours,
  deriveEarlyStartHours,
  deriveLateHours,
  deriveNormalHours,
  deriveOvertimeHours,
  fetchShiftReferences,
  parseCardClockTime,
  resolveRawPunchOutMinutes,
  TEAM_TO_SHIFT_CODE,
} from "@/lib/attendance-shift-reference";

// 인원관리(PSN-06) "근태대사" — PSN-01(일일근태입력, work_hours_daily)에 조장이 실제로
// 저장한 값과 PSN-02(출퇴근카드등록, attendance_card_status — 세콤 카드 태깅 원본)를
// 대조한다. 별도 업로드 없이 두 테이블에 이미 저장된 값만 읽는 순수 조회 화면이다.
//
// PSN-01과 동일하게 9개 항목(근로시간/정상/잔업/조출/중교/지각/조퇴/외출/지원시간)을 전부
// 보여주되(2026-09-10 사용자 요청), 세콤 근거 유무에 따라 처리가 다르다:
// - 대사(비교) 대상 5개: 근로시간, 정상, 잔업, 조출, 지각 — PSN-01/PSN-02 값을 나란히
//   보여주고 일치/불일치를 판정한다.
//   근로시간은 PSN-01은 화면 그대로(정상+잔업+조출+중교+지원)를 쓰고, 세콤 쪽은 세콤
//   재계산값 정상+조출+잔업 + 중교(PSN-01 값 그대로 반영, 2026-09-10 사용자 확인 —
//   세콤 카드에는 중교로 일한 시간도 출퇴근 사이에 그대로 찍혀 있어 정상 재계산이 휴게
//   시간으로 잘못 빼는 문제를 PSN-01 입력값으로 보정)을 더한다. 세콤 재계산 정상에서는
//   외출(PSN-01) 시간만큼 다시 빼준다(2026-09-11 사용자 확인, 정숙 09-08 사례 — 외출은
//   카드를 찍고 나가는 게 아니라 출퇴근 카드 사이에 자리를 비우는 것이라 세콤 재계산이
//   그 시간까지 전부 정상으로 잡아버림). 지원시간만 세콤에 대응되는 시간대 자체가 없어
//   계속 제외한다 — 지원시간을 실제로 쓴 날은 이 항목만 항상 차이가 남을 수 있다(의도된
//   동작).
// - 참고 표시 전용 4개: 중교, 조퇴, 외출, 지원시간 — PSN-01 값만 그대로 인정하고
//   일치/불일치 판정에서 뺀다(종합상태 판정에도 포함 안 함). 중교/외출/지원시간은 세콤에
//   근거 데이터 자체가 없어(외출은 기존부터, 중교/지원시간도 마찬가지) 세콤 값을 항상
//   null로 둔다. 조퇴는 세콤 값(derivedEarlyLeave)은 계속 재계산해 참고용으로 나란히
//   보여주되, mismatch만 항상 false로 고정한다(2026-09-14 사용자 요청, 틸라이 09-09
//   사례 — 카드 퇴근 12:18은 정식 퇴근 16:00보다 3시간42분 이르지만, 조장이 PSN-01에
//   3시간으로 입력한 게 승인된 조퇴 사유·시간이라 세콤 재계산과 달라도 그대로 인정해야
//   한다. 지각과 달리 조퇴는 "카드를 늦게/일찍 찍었는지"가 아니라 조장이 사유를 보고
//   승인한 시간이 기준이라 세콤 시간차로 강제 대사하면 안 된다는 것이 요지).
// 기준(basis)은 PSN-01과 같은 대상 작업자(use_yn='Y' AND status='정상') × 조회기간
// 전체 날짜다(2026-09-09 사용자 요청 — "저장, 미저장 둘 다 화면에 보여야" 하므로, 저장분만
// 훑던 이전 방식을 버리고 PSN-01/PSN-05와 동일한 "전체 그리드" 방식으로 바꿨다). 저장 안 된
// 날은 work_hours_daily 값을 전부 0으로 채우고 has_record=false로 표시한다 — PSN-01
// 화면처럼 휴가구분 기준 기본값(평일 8시간 등)을 추정해 채우지 않는다(그 추정값은 실제
// 입력이 아니라서 세콤 실측과 비교하면 의미 없는 차이만 만든다).

const MISMATCH_THRESHOLD_HOURS = 0.5; // 30분

// 세콤 원본 시간 필드는 "HH:MM"(기간 길이, 시각이 아님) 문자열로 저장돼 있다
// (예: "정상근무시간": "09:00" = 9시간) — 실 데이터로 확인(2026-09-09).
export function parseCardDuration(v: string | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const m = String(v).trim().match(/^(\d{1,3}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) + Number(m[2]) / 60;
}

const SECOM_NAME_PREFIXES = BIZ_NAME_PREFIXES.map((p) => p.prefix.replace(/-$/, ""));

function contractorPrefix(contractor: string | null | undefined): string {
  const entry = BIZ_NAME_PREFIXES.find((p) => p.contractor === contractor);
  return entry ? entry.prefix.replace(/-$/, "") : "";
}

// 세콤 "이름"은 접두사·이름 사이에 공백이 있는 경우("SJ 김세은")와 없는 경우
// ("DO이지우", "HT조영희") 둘 다 섞여 있다(2026-09-09 실 데이터로 확인) — 공백
// 유무와 무관하게 알려진 접두사로 시작하는지만 본다.
export function splitSecomName(raw: string): { prefix: string; name: string } {
  const trimmed = raw.trim();
  for (const prefix of SECOM_NAME_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return { prefix, name: trimmed.slice(prefix.length).trim() };
    }
  }
  return { prefix: "", name: trimmed };
}

// 변환된 사번으로 매칭된 workers 행의 성명/도급사와, 세콤 이름의 접두사/이름이 서로
// 일치하는지 확인한다(오매칭 방지용 이름 교차검증) — 접두사가 없으면 도급사는
// "메디오스"로 간주(contractorPrefix가 빈 문자열을 돌려줌).
export function secomNameMatchesWorker(
  workerName: string,
  contractor: string | null | undefined,
  secomRawName: string
): boolean {
  const expected = contractorPrefix(contractor);
  const { prefix, name } = splitSecomName(secomRawName);
  return prefix === expected && name === workerName.trim();
}

export interface AttendanceAuditItem {
  psn01: number;
  /** null이면 대조할 카드 값이 없음(카드 자체를 못 찾음) */
  psn02: number | null;
  diff: number | null;
  mismatch: boolean;
}

export type AttendanceAuditMatchStatus = "matched" | "name_mismatch" | "no_card";
export type AttendanceAuditRowStatus = "정상" | "불일치" | "매칭오류" | "카드없음";

export interface AttendanceAuditRow {
  employee_no: string;
  worker_name: string;
  work_group: string | null;
  /** 근무조(workers.team, 1조/2조/3조/주간고정) — 공정과 마찬가지로 작업자 변경이력
   *  (BASE-10)을 참조해 그 날짜 기준 "그 당시 값"을 보여준다(2026-09-10 사용자 요청). */
  team: string | null;
  /** PSN-01(일일근태입력) 휴가구분 — 세콤 근거가 없어 참고 표시 전용(일치/불일치 판정
   *  대상 아님). 그 날짜 저장분이 없으면(has_record=false) null. */
  leave_type: string | null;
  work_date: string;
  /** PSN-01에 그 날짜 저장분이 실제로 있는지(false면 아래 psn01 값은 전부 0으로 채운 것) */
  has_record: boolean;
  /** 세콤 "근무조" — BASE-09 공정(work_group)과 참고용으로만 나란히 보여준다(자동 매칭 안 함) */
  card_team: string | null;
  card_worker_name: string | null;
  /** 세콤 원본 출근/퇴근 "시각"(HH:MM:SS, PSN-02) — 지각/조출/잔업 등 재계산의 근거가 된
   *  원본 값을 화면에도 그대로 보여준다(2026-09-11 사용자 요청). 카드 자체가 없으면 null. */
  card_punch_in: string | null;
  card_punch_out: string | null;
  matchStatus: AttendanceAuditMatchStatus;
  status: AttendanceAuditRowStatus;
  items: {
    // 대사(비교) 대상 — psn02/diff가 채워지고 mismatch가 실제로 판정된다.
    total: AttendanceAuditItem;
    normal: AttendanceAuditItem;
    overtime: AttendanceAuditItem;
    early_start: AttendanceAuditItem;
    late: AttendanceAuditItem;
    early_leave: AttendanceAuditItem;
    // 참고 표시 전용 — 세콤 근거가 없어 psn02는 항상 null, mismatch는 항상 false.
    lunch_shift: AttendanceAuditItem;
    outing: AttendanceAuditItem;
    support: AttendanceAuditItem;
  };
}

/** "종합상태" 판정에 실제로 반영되는 대사 대상 항목만 — 참고 표시 전용 항목은 제외한다. */
const COMPARABLE_ITEM_KEYS = ["total", "normal", "overtime", "early_start", "late"] as const;

export interface AttendanceAuditSummary {
  /** 조회기간(dateFrom~dateTo) 전체 중 "불일치" 건수(날짜별 행 단위로 그대로 셈, 2026-09-11
   *  사용자 요청 — 같은 사람이 여러 날 겹치면 예전엔 1명으로만 집계했으나, 매칭오류
   *  건수와 같은 기준(행 단위)으로 통일한다). */
  periodMismatchCount: number;
  /** 조회기간 전체 중 "매칭오류" 건수(날짜별 행 단위로 그대로 셈) */
  nameMismatchCount: number;
}

export interface AttendanceAuditResult {
  dateFrom: string;
  dateTo: string;
  rows: AttendanceAuditRow[];
  summary: AttendanceAuditSummary;
}

function buildItem(psn01: number, psn02: number | null): AttendanceAuditItem {
  if (psn02 == null) return { psn01, psn02: null, diff: null, mismatch: false };
  const diff = psn01 - psn02;
  return { psn01, psn02, diff, mismatch: Math.abs(diff) >= MISMATCH_THRESHOLD_HOURS };
}

// 세콤 카드는 "정상 근무시간대"에 실제로 있었던 시간을 통째로 재계산할 뿐, 그 시간이
// 자공정(정상)인지 다른 공정 지원인지는 구분 못 한다(대응되는 세콤 필드 자체가 없음).
// 그래서 정상만 단독으로 비교하지 않고 정상+지원(PSN-01)의 합으로 세콤 재계산값과
// 비교한다(2026-09-11 사용자 요청, 인쇄 김은미 09-01 사례로 확인 — 자공정 근무 없이
// 디자인 공정에 지원 8시간만 했는데 정상 0/세콤 8로 항상 불일치가 떴었다. 정상 0 +
// 지원 8 = 세콤 8이므로 일치가 맞다). 지원이 0인 평소 날은 그대로 정상만 비교하는
// 것과 결과가 같다(supportHours=0이면 합이 psn01 그대로이므로).
function buildNormalItem(psn01: number, derivedPsn02: number | null, supportHours: number): AttendanceAuditItem {
  const item = buildItem(psn01, derivedPsn02);
  if (derivedPsn02 == null) return item;
  const diff = psn01 + supportHours - derivedPsn02;
  return { ...item, mismatch: Math.abs(diff) >= MISMATCH_THRESHOLD_HOURS };
}

// 조출은 "정확한 시간차"보다 "신청한 대로 실제로 발생했는지"만 우선 확인한다(2026-09-09
// 사용자 요청) — PSN-01 조출을 아예 신청 안 했으면(0 또는 미입력) 세콤 값이 얼마든
// 항상 일치 처리(불필요한 알림 방지), 조출을 실제로 신청한 날만 기존 30분 기준으로
// 정밀 비교한다.
function buildEarlyStartItem(psn01: number, derivedPsn02: number | null): AttendanceAuditItem {
  const item = buildItem(psn01, derivedPsn02);
  if (psn01 === 0) return { ...item, mismatch: false };
  return item;
}

// 조퇴는 세콤 재계산값(derivedPsn02)을 참고용으로 계속 보여주되 mismatch는 항상 false로
// 고정한다(2026-09-14 사용자 요청 — 조장이 PSN-01에 입력한 조퇴시간이 승인된 사유·시간이라
// 세콤 카드 시간차와 달라도 그대로 인정해야 한다).
function buildEarlyLeaveItem(psn01: number, derivedPsn02: number | null): AttendanceAuditItem {
  return { ...buildItem(psn01, derivedPsn02), mismatch: false };
}

// 18:30 종료(정식 잔업 종료시각, PSN-07 1조 잔업 구간 16:10~18:30 기준)까지 채운 "고정
// 신청값" 2.34시간(2시간20분)은 정확한 시간차 대신 "세콤 퇴근시각이 18:30 이후인지"만
// 으로 일치/불일치를 정한다(2026-09-09 사용자 요청 — 신청한 잔업을 실제로 다 채웠는지만
// 확인). 그 외 값은 아래 일반 규칙(신청 vs 세콤 재계산)을 쓴다.
const OVERTIME_FULL_CUTOFF_MINUTES = 18 * 60 + 30; // 18:30

// 잔업은 "신청한 시간만큼 실제로 채웠는지"만 본다(2026-09-11 사용자 요청, 조립분리
// 김미화 09-03 사례로 확인 — PSN-01 1.50h 신청에 세콤 재계산 2.07h는 신청한 1.50h를
// 이미 다 채우고 남았으므로 일치. 잔업은 신청한 만큼만 인정되고 그 이상 일한 건 상관
// 없다). 그래서 세콤 재계산값(derivedPsn02)이 신청값(psn01) 이상이면 항상 일치이고,
// 신청값보다 30분(기존 MISMATCH_THRESHOLD_HOURS) 이상 부족할 때만 불일치로 본다 —
// PSN-01=0(신청 자체가 없음)이면 derivedPsn02가 항상 0 이상이라 이 규칙 그대로 일치가
// 된다(기존 "신청 없으면 항상 일치" 특례와 결과가 같아 별도 분기가 필요 없다).
function buildOvertimeItem(
  psn01: number,
  derivedPsn02: number | null,
  rawPunchOutMinutes: number | null
): AttendanceAuditItem {
  const item = buildItem(psn01, derivedPsn02);
  if (derivedPsn02 == null) return item;
  const isFixedApplication = Math.abs(psn01 - FIXED_OVERTIME_APPLICATION_HOURS) < 0.001;
  if (isFixedApplication && rawPunchOutMinutes != null) {
    // deriveOvertimeHours와 동일하게 연속축(resolveRawPunchOutMinutes로 자정/하루 넘김을
    // 보정한 값)으로 18:30 기준과 비교한다(2026-09-22 실사례 — 06:34 출근, 다음날 05:42
    // 퇴근처럼 하루를 꼬박 넘긴 경우, 보정 없이 원시 퇴근시각만 보면 05:42 < 18:30이라
    // 실제로는 18:30을 훨씬 넘겨 채웠는데도 미달로 오판된다).
    return { ...item, mismatch: rawPunchOutMinutes < OVERTIME_FULL_CUTOFF_MINUTES };
  }
  return { ...item, mismatch: psn01 - derivedPsn02 >= MISMATCH_THRESHOLD_HOURS };
}

interface WorkerRow {
  employee_no: string;
  worker_name: string;
  contractor: string | null;
  work_group: string | null;
  team: string | null;
}

interface DailyRow {
  employee_no: string;
  work_date: string;
  leave_type: string | null;
  normal_hours: number;
  overtime_hours: number;
  early_start_hours: number;
  lunch_shift_hours: number;
  late_hours: number;
  early_leave_hours: number;
  outing_hours: number;
}

interface SupportRow {
  employee_no: string;
  work_date: string;
  support_hours: number;
}

interface CardRow {
  employee_no: string;
  work_date: string;
  worker_name: string | null;
  team: string | null;
  detail: string | null;
}

export function fetchAttendanceAudit(
  db: DatabaseSync,
  params: { dateFrom: string; dateTo: string; workGroup: string; leaderWorkGroups: string[] | null }
): AttendanceAuditResult {
  const empty: AttendanceAuditResult = {
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    rows: [],
    summary: { periodMismatchCount: 0, nameMismatchCount: 0 },
  };
  if (params.leaderWorkGroups && params.leaderWorkGroups.length === 0) return empty;

  // 대상 작업자 = PSN-01(일일근태입력)과 같은 기준(use_yn='Y' AND status='정상').
  const workerConditions = ["use_yn = 'Y'", "status = '정상'"];
  const workerArgs: string[] = [];
  if (params.workGroup) {
    workerConditions.push("work_group = ?");
    workerArgs.push(params.workGroup);
  }
  if (params.leaderWorkGroups) {
    const placeholders = params.leaderWorkGroups.map(() => "?").join(",");
    workerConditions.push(`work_group IN (${placeholders})`);
    workerArgs.push(...params.leaderWorkGroups);
  }
  const workers = db
    .prepare(
      `SELECT employee_no, worker_name, contractor, work_group, team FROM workers
       WHERE ${workerConditions.join(" AND ")} ORDER BY seq, employee_no`
    )
    .all(...workerArgs) as unknown as WorkerRow[];

  if (workers.length === 0) return empty;

  const employeeNos = workers.map((w) => w.employee_no);
  const dates = dateRange(params.dateFrom, params.dateTo);

  // 공정(work_group)은 작업자 변경이력(BASE-10)을 참조해 그 날짜 기준 "그 당시 값"을
  // 보여준다(2026-09-09 사용자 요청) — 이 화면은 이미 (작업자, 날짜) 그리드라 날짜별로
  // 정확히 스냅샷할 수 있다(PSN-05처럼 조회기간 하나로 뭉뚱그리지 않아도 됨). 대상 작업자를
  // 고르는 필터(workGroup/leaderWorkGroups)는 그대로 현재 소속 기준을 유지한다 — "이
  // 공정 사람들을 보여줘"는 현재 조직 기준이 맞고, 그 사람들의 각 날짜 표시값만
  // 과거 시점으로 되돌린다.
  const workGroupHistory = fetchFieldHistoryMap(db, ENTITY_TYPE_WORKER, "work_group", employeeNos);
  // 근무조(team)도 공정과 같은 이유로 날짜별 스냅샷이 필요하다(2026-09-10 사용자 요청 —
  // PSN-06 공정과 일자 사이에 근무조 열을 추가하면서 같이 반영).
  const teamHistory = fetchFieldHistoryMap(db, ENTITY_TYPE_WORKER, "team", employeeNos);

  // 지각/조출/잔업 기준시각(근무시간정보 PSN-07 참조) — 2026-09-09 사용자 요청으로
  // 세콤 원본의 지각시간/조기출근시간/연장근무시간 필드는 더 이상 쓰지 않는다(전수 확인
  // 결과 근무스케줄이 100% "유동"이라 이 3개 필드가 항상 "00:00"으로만 들어온다 — 세콤이
  // 지각 판정 자체를 안 하는 것). 대신 세콤의 실제 출근시간/퇴근시간(찍힌 시각 자체는
  // 정확함)을 PSN-07 스케줄 기준으로 우리가 직접 재계산한다.
  const shiftRefs = fetchShiftReferences(db);

  const placeholders = employeeNos.map(() => "?").join(",");
  const dailyRows = db
    .prepare(
      `SELECT employee_no, work_date, leave_type, normal_hours, overtime_hours, early_start_hours, lunch_shift_hours,
              late_hours, early_leave_hours, outing_hours
       FROM work_hours_daily WHERE employee_no IN (${placeholders}) AND work_date BETWEEN ? AND ?`
    )
    .all(...employeeNos, params.dateFrom, params.dateTo) as unknown as DailyRow[];
  const dailyByKey = new Map(dailyRows.map((r) => [`${r.employee_no}|${r.work_date}`, r]));

  // 지원시간("지원시간" 참고 표시 전용) — PSN-01과 같은 자연키(work_date+employee_no)라
  // 하루 1건뿐이다.
  const supportRows = db
    .prepare(
      `SELECT employee_no, work_date, support_hours
       FROM work_support_detail WHERE employee_no IN (${placeholders}) AND work_date BETWEEN ? AND ?`
    )
    .all(...employeeNos, params.dateFrom, params.dateTo) as unknown as SupportRow[];
  const supportByKey = new Map(supportRows.map((r) => [`${r.employee_no}|${r.work_date}`, r.support_hours]));

  const cardRows = db
    .prepare(
      `SELECT employee_no, work_date, worker_name, team, detail FROM attendance_card_status
       WHERE work_date BETWEEN ? AND ?`
    )
    .all(params.dateFrom, params.dateTo) as unknown as CardRow[];

  const cardByKey = new Map<string, { worker_name: string | null; team: string | null; detail: Record<string, unknown> }>();
  for (const r of cardRows) {
    const converted = convertBizEmployeeNo(r.employee_no);
    if (!converted) continue;
    const key = `${converted}|${r.work_date}`;
    // 사번 변환 공식이 원본 13자리 중 일부(순번 앞자리)를 버리므로 이론상 같은 날 같은
    // 변환값이 중복될 수 있다 — 실 데이터에서 아직 충돌은 못 봤고, 충돌 시 먼저 나온
    // 값을 그대로 쓴다(둘 다 반영하면 대사 결과가 모호해지므로).
    if (!cardByKey.has(key)) {
      cardByKey.set(key, {
        worker_name: r.worker_name,
        team: r.team,
        detail: r.detail ? (JSON.parse(r.detail) as Record<string, unknown>) : {},
      });
    }
  }

  // 한 (작업자, 날짜) 쌍의 대사 결과를 계산한다 — 화면에 보이는 그리드와, 조회기간과
  // 무관한 "오늘" 요약 집계 양쪽에서 공유해서 쓴다.
  function computeCell(
    w: WorkerRow,
    workDate: string
  ): Pick<
    AttendanceAuditRow,
    | "has_record"
    | "leave_type"
    | "card_team"
    | "card_worker_name"
    | "card_punch_in"
    | "card_punch_out"
    | "matchStatus"
    | "status"
    | "items"
  > {
    const daily = dailyByKey.get(`${w.employee_no}|${workDate}`);
    const hasRecord = daily != null;
    const normalHours = daily?.normal_hours ?? 0;
    const overtimeHours = daily?.overtime_hours ?? 0;
    const earlyStartHours = daily?.early_start_hours ?? 0;
    const lunchShiftHours = daily?.lunch_shift_hours ?? 0;
    const lateHours = daily?.late_hours ?? 0;
    const earlyLeaveHours = daily?.early_leave_hours ?? 0;
    const outingHours = daily?.outing_hours ?? 0;
    const supportHours = supportByKey.get(`${w.employee_no}|${workDate}`) ?? 0;
    // 근로시간(PSN-01 "근무시간") = 정상+잔업+조출+중교+지원(api/work-hours/route.ts의
    // computeTotal과 동일한 공식) — 지각/조퇴/외출은 합계에 반영하지 않는다.
    const totalHours = normalHours + overtimeHours + earlyStartHours + lunchShiftHours + supportHours;

    const card = cardByKey.get(`${w.employee_no}|${workDate}`);

    let matchStatus: AttendanceAuditMatchStatus = "no_card";
    let cardTeam: string | null = null;
    let cardWorkerName: string | null = null;
    let cardPunchIn: string | null = null;
    let cardPunchOut: string | null = null;
    let items: AttendanceAuditRow["items"] = {
      total: buildItem(totalHours, null),
      normal: buildNormalItem(normalHours, null, supportHours),
      overtime: buildOvertimeItem(overtimeHours, null, null),
      early_start: buildEarlyStartItem(earlyStartHours, null),
      late: buildItem(lateHours, null),
      early_leave: buildItem(earlyLeaveHours, null),
      // 중교/외출/지원시간은 세콤에 근거 데이터 자체가 없어 카드가 있어도 비교하지 않는다
      // (아래 if(card) 블록에서도 다시 안 건드림 — 항상 참고 표시 전용).
      lunch_shift: buildItem(lunchShiftHours, null),
      outing: buildItem(outingHours, null),
      support: buildItem(supportHours, null),
    };

    if (card) {
      cardTeam = card.team;
      cardWorkerName = card.worker_name;
      const nameOk = cardWorkerName ? secomNameMatchesWorker(w.worker_name, w.contractor, cardWorkerName) : false;
      matchStatus = nameOk ? "matched" : "name_mismatch";

      // 지각/조출/잔업/조퇴는 세콤이 내려주는 지각시간/조기출근시간/연장근무시간 필드를 더
      // 이상 믿지 않고(항상 "00:00"), 실제 출근시간/퇴근시간을 PSN-07 기준시각으로 우리가
      // 직접 재계산한다. 대응되는 조 스케줄이 없으면(주간고정 등) psn02=null로 남겨
      // 비교 자체를 건너뛴다(buildItem이 null을 "대조 불가"로 처리). 근무조는 workers.team
      // 현재값이 아니라 그 날짜(workDate) 기준 이력값을 써야 한다(2026-09-11 사용자 확인,
      // 생산지원 김세은 사례 — 9/1엔 실제로 1조(주간)였는데 9/10에 2조(야간)로 바뀐 뒤
      // 조회하면, 현재값(2조)만 보고 9/1도 야간 스케줄로 재계산해 정상/조퇴가 크게
      // 어긋났었다. work_group과 마찬가지로 resolveFieldAsOf로 그 날짜 당시 값을 구해야
      // 조가 중간에 바뀐 사람도 지난 날짜가 정확히 대사된다).
      const teamAsOfDate = resolveFieldAsOf(teamHistory, w.employee_no, workDate, w.team);
      const shiftCode = teamAsOfDate ? TEAM_TO_SHIFT_CODE[teamAsOfDate] : undefined;
      const ref = shiftCode ? shiftRefs.get(shiftCode) : undefined;
      const punchIn = parseCardClockTime(card.detail["출근시간"]);
      const punchOut = parseCardClockTime(card.detail["퇴근시간"]);
      cardPunchIn = typeof card.detail["출근시간"] === "string" ? (card.detail["출근시간"] as string) : null;
      cardPunchOut = typeof card.detail["퇴근시간"] === "string" ? (card.detail["퇴근시간"] as string) : null;
      // 퇴근시각을 "연속축"(자정/하루를 넘기면 1440분 이상)으로 한 번만 보정해 아래
      // deriveNormalHours/deriveOvertimeHours/deriveEarlyLeaveHours/buildOvertimeItem이
      // 전부 같은 값을 쓰게 한다 — 세콤 "총근무시간"(HH:MM, 24시간을 넘길 수 있음)이
      // 있으면 그걸로 punchIn+총근무시간을 우선 신뢰하고, 없으면 기존처럼 "퇴근이
      // 출근보다 이르면 다음날"로만 추정한다(resolveRawPunchOutMinutes 참고).
      const totalWorkedHours = parseCardDuration(card.detail["총근무시간"] as string | number | null);
      const rawPunchOut =
        punchIn != null && punchOut != null ? resolveRawPunchOutMinutes(punchIn, punchOut, totalWorkedHours) : null;
      // PSN-01 휴가구분이 "전반"(오전반차)/"후반"(오후반차)이면 세콤 카드의 실제 출근/
      // 퇴근시각이 늦거나 일러도 승인된 반차라 지각/조퇴가 아니다(2026-09-11 사용자
      // 요청) — 전반이면 지각 PSN-02를 항상 0, 후반이면 조퇴 PSN-02를 항상 0으로 고정해
      // 세콤 재계산값을 무시한다. 1조/2조/3조를 따로 안 가려도 되는 이유: derivedLate/
      // derivedEarlyLeave 자체가 이미 그 사람 소속 조의 ref(PSN-07 시각)를 쓰므로 조별
      // 시각 차이는 ref 조회 단계에서 이미 반영돼 있다.
      const isMorningHalfDay = daily?.leave_type === "전반";
      const isAfternoonHalfDay = daily?.leave_type === "후반";
      const derivedLate = isMorningHalfDay ? 0 : ref ? deriveLateHours(punchIn, ref) : null;
      const derivedEarlyStart = ref ? deriveEarlyStartHours(punchIn, ref) : null;
      const derivedOvertime = ref ? deriveOvertimeHours(rawPunchOut, ref) : null;
      // 조퇴는 지각과 동일하게 그레이스 없이 정확한 시간차로 계산한다(정식 퇴근시각 =
      // PSN-07 "3Q" 종료시각, 2026-09-10 사용자 확인).
      const derivedEarlyLeave = isAfternoonHalfDay ? 0 : ref ? deriveEarlyLeaveHours(rawPunchOut, ref) : null;
      // 정상근무시간도 세콤 원본 필드(휴게/식사시간을 안 뺀 총 체류시간)를 그대로 안 믿고
      // 출근~퇴근시각에서 겹치는 휴게/식사시간만큼 직접 빼서 재계산한다(2026-09-09 사용자
      // 요청). 대응되는 조 스케줄이 없으면(주간고정 등) 기존처럼 세콤 원본값을 그대로 쓴다.
      const derivedNormal = ref ? deriveNormalHours(punchIn, rawPunchOut, ref) : null;
      // 외출(PSN-01)도 세콤 재계산이 모르는 시간대다(중교와 달리 외출은 카드를 찍고 나갔다
      // 들어오는 게 아니라 출근~퇴근 카드 사이에 그냥 자리를 비운 것이라 출퇴근시각만으로
      // 재계산하면 그 시간까지 전부 "정상"으로 잡힌다) — PSN-01에 신청된 외출시간만큼
      // 보정한다. PSN-01 쪽 잔업(work-hours-leave.ts의 computeAttendanceHours)이 이미
      // "외출은 잔업(신청값)에서 먼저 흡수하고, 못 흡수한 초과분만 정상에서 뺀다"는
      // 순서로 저장돼 있으므로, 세콤 쪽도 같은 순서로 맞춰야 두 값이 같은 개념을
      // 비교하게 된다(2026-09-13 사용자 요청, 김은경2 9/8 사례 — 세콤 재계산 잔업이
      // 커서 외출을 다 흡수하고도 남는데, 예전엔 잔업과 무관하게 외출을 항상 정상에서만
      // 빼서 정상/잔업 두 항목 모두 실제보다 크게 어긋나 보였다). 대응되는 조 스케줄이
      // 없어 derivedOvertime 자체가 없으면(null) 흡수시킬 잔업이 없는 것이니 기존처럼
      // 외출 전액을 정상에서 뺀다.
      const rawDerivedOvertime = derivedOvertime;
      const outingAbsorbedByOvertime = rawDerivedOvertime != null ? Math.min(outingHours, rawDerivedOvertime) : 0;
      const outingExcessOnNormal = outingHours - outingAbsorbedByOvertime;
      const derivedOvertimeAfterOuting =
        rawDerivedOvertime != null ? rawDerivedOvertime - outingAbsorbedByOvertime : null;
      const normalPsn02Raw =
        derivedNormal ?? parseCardDuration(card.detail["정상근무시간"] as string | number | null);
      const normalPsn02 = Math.max(0, normalPsn02Raw - outingExcessOnNormal);
      const overtimeItem = buildOvertimeItem(overtimeHours, derivedOvertimeAfterOuting, rawPunchOut);
      const earlyStartItem = buildEarlyStartItem(earlyStartHours, derivedEarlyStart);
      // 근로시간의 조출/잔업 기여분 — 세콤 카드가 일찍 출근·늦게 퇴근을 찍어도 PSN-01에
      // 조출·잔업 신청이 없으면 인정되지 않는다(2026-09-10 사용자 확인, 실링 박용자·
      // 권원교 사례 — 둘 다 PSN-01 조출 0인데 카드는 정식 출근보다 일찍 찍혀 있어, 세콤
      // 재계산값을 그대로 더하면 조출/잔업 항목 자체는 "일치"인데 근로시간만 차이나는
      // 모순이 생겼었다). 그래서 그 항목 자체가 "일치"로 판정됐을 때(=PSN-01이 그대로
      // 인정된 상태)는 PSN-01 값을 쓰고, 진짜 "불일치"일 때만 세콤 재계산값을 써서 실제
      // 차이를 근로시간에도 반영한다.
      const earlyStartForTotal = earlyStartItem.mismatch ? (derivedEarlyStart ?? 0) : earlyStartHours;
      const overtimeForTotal = overtimeItem.mismatch ? (derivedOvertimeAfterOuting ?? 0) : overtimeHours;
      // 근로시간(세콤 쪽) = 세콤 재계산 정상 + 위 조출/잔업 기여분 + 중교(PSN-01 값 그대로,
      // 2026-09-10 사용자 확인, 실링 김경옥 사례로 요청 — 세콤 카드는 출근~퇴근 사이에
      // 중교로 실제 일한 시간까지 그대로 찍혀 있지만(별도 외출/복귀 기록이 없음), 정상
      // 재계산(deriveNormalHours)이 그 시간을 휴게시간으로 보고 일괄로 빼버려 중교를 쓴
      // 날마다 근로시간만 항상 차이가 나던 문제를 없앤다). 지원시간은 세콤에 근거 자체가
      // 없어(중교와 달리 대응되는 세콤 시간대 자체가 없음) 계속 제외한다.
      const totalPsn02 = normalPsn02 + earlyStartForTotal + overtimeForTotal + lunchShiftHours;

      items = {
        total: buildItem(totalHours, totalPsn02),
        normal: buildNormalItem(normalHours, normalPsn02, supportHours),
        overtime: overtimeItem,
        early_start: earlyStartItem,
        late: buildItem(lateHours, derivedLate),
        early_leave: buildEarlyLeaveItem(earlyLeaveHours, derivedEarlyLeave),
        // 중교/외출/지원시간은 세콤 원본에 근거 자체가 없다(외출시간 필드도 항상 "00:00",
        // 외출List/복귀List도 전부 공란으로 확인됨, 2026-09-09 — 중교/지원시간도 대응되는
        // 세콤 필드 자체가 없음) — 비교하지 않고 항상 참고 표시 전용으로 둔다.
        lunch_shift: buildItem(lunchShiftHours, null),
        outing: buildItem(outingHours, null),
        support: buildItem(supportHours, null),
      };
    }

    const anyMismatch = COMPARABLE_ITEM_KEYS.some((key) => items[key].mismatch);
    const status: AttendanceAuditRowStatus =
      matchStatus === "name_mismatch"
        ? "매칭오류"
        : matchStatus === "no_card"
          ? "카드없음"
          : anyMismatch
            ? "불일치"
            : "정상";

    return {
      has_record: hasRecord,
      leave_type: daily?.leave_type ?? null,
      card_team: cardTeam,
      card_worker_name: cardWorkerName,
      card_punch_in: cardPunchIn,
      card_punch_out: cardPunchOut,
      matchStatus,
      status,
      items,
    };
  }

  // "불일치 건수"/"매칭오류 건수" 둘 다 화면에 지금 조회된 기간(dates) 전체 기준이고
  // (2026-09-09 사용자 확인 — 조회기간을 특정 하루로 좁혀도 그 결과와 일치해야 한다.
  // 예전엔 인원 수만 서버 실제 날짜(오늘)로 고정해뒀었는데, 조회기간이 그 날짜를
  // 포함하지 않으면 항상 0으로 나와 눈에 보이는 표와 안 맞았다 — 매칭오류 건수와
  // 똑같이 조회기간 기준으로 통일한다), 둘 다 날짜별 행 단위로 그대로 센다(2026-09-11
  // 사용자 요청 — 예전엔 "불일치"만 같은 사람이 여러 날 겹쳐도 1명으로 집계했는데,
  // 매칭오류 건수와 기준이 달라 헷갈려서 건수 기준으로 통일).
  let nameMismatchCount = 0;
  let periodMismatchCount = 0;
  const rows: AttendanceAuditRow[] = [];
  for (const w of workers) {
    for (const workDate of dates) {
      const cell = computeCell(w, workDate);
      if (cell.matchStatus === "name_mismatch") nameMismatchCount++;
      if (cell.status === "불일치") periodMismatchCount++;
      const workGroupAsOf = resolveFieldAsOf(workGroupHistory, w.employee_no, workDate, w.work_group);
      const teamAsOf = resolveFieldAsOf(teamHistory, w.employee_no, workDate, w.team);
      rows.push({
        employee_no: w.employee_no,
        worker_name: w.worker_name,
        work_group: workGroupAsOf,
        team: teamAsOf,
        work_date: workDate,
        ...cell,
      });
    }
  }

  return {
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    rows,
    summary: { periodMismatchCount, nameMismatchCount },
  };
}
