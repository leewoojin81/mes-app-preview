import type { DatabaseSync } from "node:sqlite";
import { dateRange, PAGE_ROW_LIMIT } from "@/lib/work-hours-lookup";

// 인원관리(PSN-05) "비즈" 탭 — 비즈 근태 시스템의 "기간별 근무관리" 리포트(비즈.xlsx)를 그대로
// 올려 보여주는 조회 전용 데이터. 사번·부서·성명·직위는 사람의 첫 행에만 적혀 있고 사람마다
// 마지막 줄에 "( 소 계 )" 행이 붙는 원본 구조라, 저장할 때는 모든 일별 행에 사람 정보를 채워
// 넣고 소계 행은 버린다(소계는 조회 때 다시 합산한다). 시간(정근/연장/야간 등)은 원본이 엑셀
// "하루의 분율"(0.3333 = 8:00)이라 정수 분으로 바꿔 저장한다 — 빈칸은 NULL.
//
// 업로드는 다른 대용량 리포트와 같은 "구간 재동기화": 파일의 출근일자 최소~최대 구간의 기존
// 데이터를 지우고 파일 내용으로 새로 채운다(재업로드 시 원본에서 빠진 행이 남지 않게).

export const BIZ_DURATION_KEYS = [
  "late",
  "early_leave",
  "early_start",
  "lunch_shift",
  "overtime",
  "normal",
  "extension",
  "night",
  "special",
  "special_holiday",
  "special_sat",
] as const;
export type BizDurationKey = (typeof BIZ_DURATION_KEYS)[number];

export interface BizDayRow {
  work_date: string;
  shift: string | null;
  in_time: string | null;
  out_date: string | null;
  out_time: string | null;
  late: number | null;
  early_leave: number | null;
  early_start: number | null;
  lunch_shift: number | null;
  overtime: number | null;
  normal: number | null;
  extension: number | null;
  night: number | null;
  special: number | null;
  special_holiday: number | null;
  special_sat: number | null;
  note: string | null;
}

export interface BizTotals {
  /** 일별 행 수(원본 소계 행의 "타임" 칸) */
  days: number;
  /** 출근시간/퇴근시간이 있는 행 수(원본 소계 행의 출근시간·퇴근시간 칸) */
  in_count: number;
  out_count: number;
  late: number;
  early_leave: number;
  early_start: number;
  lunch_shift: number;
  overtime: number;
  normal: number;
  extension: number;
  night: number;
  special: number;
  special_holiday: number;
  special_sat: number;
}

export interface BizPerson {
  employee_no: string;
  dept: string | null;
  worker_name: string | null;
  position: string | null;
  rows: BizDayRow[];
  totals: BizTotals;
}

export interface BizLookupPage {
  dateFrom: string;
  dateTo: string;
  persons: BizPerson[];
  totalPersons: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** 화면 부서 필터 후보(전체 업로드 데이터 기준) */
  depts: string[];
  /** 조회기간 안에서 가장 최근 업로드 시각(업로드가 없으면 null) */
  uploadedAt: string | null;
  /** 업로드돼 있는 데이터 전체의 출근일자 범위(없으면 null) — 화면이 조회기간 안내/이동에 쓴다 */
  dataFrom: string | null;
  dataTo: string | null;
}

export function ensureBizAttendanceTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS biz_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_no TEXT NOT NULL,
      dept TEXT,
      worker_name TEXT,
      position TEXT,
      shift TEXT,
      work_date TEXT NOT NULL,
      in_time TEXT,
      out_date TEXT,
      out_time TEXT,
      late_min INTEGER,
      early_leave_min INTEGER,
      early_start_min INTEGER,
      lunch_shift_min INTEGER,
      overtime_min INTEGER,
      normal_min INTEGER,
      extension_min INTEGER,
      night_min INTEGER,
      special_min INTEGER,
      special_holiday_min INTEGER,
      special_sat_min INTEGER,
      note TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_biz_attendance_date ON biz_attendance(work_date);
    CREATE INDEX IF NOT EXISTS idx_biz_attendance_employee ON biz_attendance(employee_no, work_date);
  `);
}

// ── 업로드 파일 파싱 ─────────────────────────────────────────────────────────

export interface ParsedBizRow extends BizDayRow {
  employee_no: string;
  dept: string | null;
  worker_name: string | null;
  position: string | null;
}

function cellStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** 엑셀 "하루의 분율"(0.3333 = 8:00) 또는 "HH:MM" 문자열을 정수 분으로 — 빈칸/해석 불가는 null */
function cellMinutes(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 1440) : null;
  const m = /^(\d+):(\d{2})(?::\d{2})?$/.exec(String(v).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function normalizeDate(v: unknown): string | null {
  const s = cellStr(v);
  if (!s) return null;
  const m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(s);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}

function normHeader(v: unknown): string {
  return v == null ? "" : String(v).replace(/\s+/g, "");
}

/**
 * 비즈 "기간별 근무관리" 시트(2차원 배열)를 일별 행으로 푼다. 헤더 행("사번"이 있는 행)을 찾아
 * 열 위치를 이름으로 잡는다(열이 늘거나 줄어도 견디도록). 소계 행("( 소 계 )")은 버리고,
 * 사번이 비어 있는 행은 바로 위 사람의 사번/부서/성명/직위를 이어받는다.
 */
export function parseBizSheet(rows: unknown[][]): { rows: ParsedBizRow[]; skipped: number } | { error: string } {
  const headerRowIdx = rows.findIndex((r) => (r ?? []).some((c) => normHeader(c) === "사번"));
  if (headerRowIdx === -1) return { error: '"사번" 헤더 행을 찾을 수 없습니다. 비즈 "기간별 근무관리" 엑셀이 맞는지 확인하세요.' };
  const header = (rows[headerRowIdx] ?? []).map(normHeader);
  const idx = (name: string) => header.indexOf(name);
  const need = ["사번", "출근일자"];
  const missing = need.filter((n) => idx(n) === -1);
  if (missing.length > 0) return { error: `헤더에서 다음 컬럼을 찾을 수 없습니다: ${missing.join(", ")}` };

  const col = {
    employee_no: idx("사번"),
    dept: idx("부서"),
    worker_name: idx("성명"),
    position: idx("직위"),
    shift: idx("타임"),
    work_date: idx("출근일자"),
    in_time: idx("출근시간"),
    out_date: idx("퇴근일자"),
    out_time: idx("퇴근시간"),
    late: idx("지각"),
    early_leave: idx("조퇴"),
    early_start: idx("조출"),
    lunch_shift: idx("중교"),
    overtime: idx("잔업"),
    normal: idx("정근"),
    extension: idx("연장"),
    night: idx("야간"),
    special: idx("특근"),
    // "특연"은 두 칸(휴일/토요)을 합친 머리글 — 왼쪽 칸이 휴일, 오른쪽 칸이 토요
    special_holiday: idx("특연"),
    special_sat: idx("특연") === -1 ? -1 : idx("특연") + 1,
    note: idx("비고"),
  };
  const at = (r: unknown[], i: number): unknown => (i === -1 ? null : r[i]);

  const out: ParsedBizRow[] = [];
  let skipped = 0;
  let cur: { employee_no: string; dept: string | null; worker_name: string | null; position: string | null } | null = null;

  for (const r of rows.slice(headerRowIdx + 1)) {
    if (!r) continue;
    const empRaw = cellStr(at(r, col.employee_no));
    if (empRaw && normHeader(empRaw).includes("소계")) continue; // 소계 행은 저장하지 않는다
    if (empRaw) {
      cur = {
        employee_no: empRaw,
        dept: cellStr(at(r, col.dept)),
        worker_name: cellStr(at(r, col.worker_name)),
        position: cellStr(at(r, col.position)),
      };
    }
    const workDate = normalizeDate(at(r, col.work_date));
    if (!workDate) {
      // 서식 머리글 보조행(휴일/토요 등)이나 빈 줄
      if (cellStr(at(r, col.shift)) || cellStr(at(r, col.in_time))) skipped++;
      continue;
    }
    if (!cur) {
      skipped++;
      continue;
    }
    out.push({
      ...cur,
      work_date: workDate,
      shift: cellStr(at(r, col.shift)),
      in_time: cellStr(at(r, col.in_time)),
      out_date: normalizeDate(at(r, col.out_date)),
      out_time: cellStr(at(r, col.out_time)),
      late: cellMinutes(at(r, col.late)),
      early_leave: cellMinutes(at(r, col.early_leave)),
      early_start: cellMinutes(at(r, col.early_start)),
      lunch_shift: cellMinutes(at(r, col.lunch_shift)),
      overtime: cellMinutes(at(r, col.overtime)),
      normal: cellMinutes(at(r, col.normal)),
      extension: cellMinutes(at(r, col.extension)),
      night: cellMinutes(at(r, col.night)),
      special: cellMinutes(at(r, col.special)),
      special_holiday: cellMinutes(at(r, col.special_holiday)),
      special_sat: cellMinutes(at(r, col.special_sat)),
      note: cellStr(at(r, col.note)),
    });
  }
  return { rows: out, skipped };
}

export function importBizRows(
  db: DatabaseSync,
  parsed: ParsedBizRow[]
): { dateFrom: string; dateTo: string; deleted: number; inserted: number } {
  ensureBizAttendanceTable(db);
  let dateFrom = parsed[0].work_date;
  let dateTo = parsed[0].work_date;
  for (const r of parsed) {
    if (r.work_date < dateFrom) dateFrom = r.work_date;
    if (r.work_date > dateTo) dateTo = r.work_date;
  }
  const insert = db.prepare(
    `INSERT INTO biz_attendance (
       employee_no, dept, worker_name, position, shift, work_date, in_time, out_date, out_time,
       late_min, early_leave_min, early_start_min, lunch_shift_min, overtime_min, normal_min,
       extension_min, night_min, special_min, special_holiday_min, special_sat_min, note
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  let deleted = 0;
  db.exec("BEGIN");
  try {
    deleted = (
      db.prepare("SELECT COUNT(*) c FROM biz_attendance WHERE work_date BETWEEN ? AND ?").get(dateFrom, dateTo) as {
        c: number;
      }
    ).c;
    db.prepare("DELETE FROM biz_attendance WHERE work_date BETWEEN ? AND ?").run(dateFrom, dateTo);
    for (const r of parsed) {
      insert.run(
        r.employee_no,
        r.dept,
        r.worker_name,
        r.position,
        r.shift,
        r.work_date,
        r.in_time,
        r.out_date,
        r.out_time,
        r.late,
        r.early_leave,
        r.early_start,
        r.lunch_shift,
        r.overtime,
        r.normal,
        r.extension,
        r.night,
        r.special,
        r.special_holiday,
        r.special_sat,
        r.note
      );
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { dateFrom, dateTo, deleted, inserted: parsed.length };
}

// ── 조회 ─────────────────────────────────────────────────────────────────────

interface DbRow {
  employee_no: string;
  dept: string | null;
  worker_name: string | null;
  position: string | null;
  shift: string | null;
  work_date: string;
  in_time: string | null;
  out_date: string | null;
  out_time: string | null;
  late_min: number | null;
  early_leave_min: number | null;
  early_start_min: number | null;
  lunch_shift_min: number | null;
  overtime_min: number | null;
  normal_min: number | null;
  extension_min: number | null;
  night_min: number | null;
  special_min: number | null;
  special_holiday_min: number | null;
  special_sat_min: number | null;
  note: string | null;
}

export interface BizQuery {
  dateFrom: string;
  dateTo: string;
  /** 사번 또는 성명 일부 */
  q: string;
  dept: string;
  /** 조장 세션이면 자기 소속공정(work_group) 목록 — 비즈 사번(workers.biz_employee_no)으로 좁힌다 */
  leaderWorkGroups: string[] | null;
}

function buildWhere(p: BizQuery): { sql: string; args: (string | number)[] } {
  const cond = ["work_date BETWEEN ? AND ?"];
  const args: (string | number)[] = [p.dateFrom, p.dateTo];
  const q = p.q.trim();
  if (q) {
    cond.push("(employee_no LIKE ? OR worker_name LIKE ?)");
    args.push(`%${q}%`, `%${q}%`);
  }
  if (p.dept) {
    cond.push("dept = ?");
    args.push(p.dept);
  }
  if (p.leaderWorkGroups) {
    if (p.leaderWorkGroups.length === 0) {
      cond.push("1 = 0");
    } else {
      const ph = p.leaderWorkGroups.map(() => "?").join(",");
      cond.push(
        `employee_no IN (SELECT biz_employee_no FROM workers WHERE biz_employee_no IS NOT NULL AND work_group IN (${ph}))`
      );
      args.push(...p.leaderWorkGroups);
    }
  }
  return { sql: cond.join(" AND "), args };
}

function emptyTotals(): BizTotals {
  return {
    days: 0,
    in_count: 0,
    out_count: 0,
    late: 0,
    early_leave: 0,
    early_start: 0,
    lunch_shift: 0,
    overtime: 0,
    normal: 0,
    extension: 0,
    night: 0,
    special: 0,
    special_holiday: 0,
    special_sat: 0,
  };
}

function toPersons(rows: DbRow[]): BizPerson[] {
  const byEmp = new Map<string, BizPerson>();
  for (const r of rows) {
    let p = byEmp.get(r.employee_no);
    if (!p) {
      p = {
        employee_no: r.employee_no,
        dept: r.dept,
        worker_name: r.worker_name,
        position: r.position,
        rows: [],
        totals: emptyTotals(),
      };
      byEmp.set(r.employee_no, p);
    }
    const day: BizDayRow = {
      work_date: r.work_date,
      shift: r.shift,
      in_time: r.in_time,
      out_date: r.out_date,
      out_time: r.out_time,
      late: r.late_min,
      early_leave: r.early_leave_min,
      early_start: r.early_start_min,
      lunch_shift: r.lunch_shift_min,
      overtime: r.overtime_min,
      normal: r.normal_min,
      extension: r.extension_min,
      night: r.night_min,
      special: r.special_min,
      special_holiday: r.special_holiday_min,
      special_sat: r.special_sat_min,
      note: r.note,
    };
    p.rows.push(day);
    const t = p.totals;
    // 원본 소계 행의 "타임" 칸(일수) — 출근/퇴근시간이 있거나 타임(1조/2조/⑤/⑥)이 적힌 행만 센다.
    // 원본은 연차 행을 일부만 세는 등 규칙이 일정하지 않아 인원의 약 78%만 정확히 일치한다.
    if (day.in_time || day.out_time || day.shift) t.days++;
    if (day.in_time) t.in_count++;
    if (day.out_time) t.out_count++;
    for (const k of BIZ_DURATION_KEYS) t[k] += day[k] ?? 0;
  }
  return [...byEmp.values()];
}

const SELECT_COLS = `employee_no, dept, worker_name, position, shift, work_date, in_time, out_date, out_time,
  late_min, early_leave_min, early_start_min, lunch_shift_min, overtime_min, normal_min, extension_min,
  night_min, special_min, special_holiday_min, special_sat_min, note`;

/** 조건에 맞는 사람 목록(업로드 순서 — 그 구간에서 처음 나온 행 순) */
function listEmployeeNos(db: DatabaseSync, p: BizQuery): string[] {
  const w = buildWhere(p);
  return (
    db
      .prepare(`SELECT employee_no FROM biz_attendance WHERE ${w.sql} GROUP BY employee_no ORDER BY MIN(id)`)
      .all(...w.args) as { employee_no: string }[]
  ).map((r) => r.employee_no);
}

function fetchPersonsByEmployeeNos(db: DatabaseSync, p: BizQuery, employeeNos: string[]): BizPerson[] {
  if (employeeNos.length === 0) return [];
  const w = buildWhere(p);
  const ph = employeeNos.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLS} FROM biz_attendance
       WHERE ${w.sql} AND employee_no IN (${ph}) ORDER BY id`
    )
    .all(...w.args, ...employeeNos) as unknown as DbRow[];
  const persons = toPersons(rows);
  // 조회 구간 안에서 사람 순서를 업로드 순서(employeeNos 순서)로 맞춘다
  const order = new Map(employeeNos.map((n, i) => [n, i]));
  persons.sort((a, b) => (order.get(a.employee_no) ?? 0) - (order.get(b.employee_no) ?? 0));
  for (const person of persons) person.rows.sort((a, b) => a.work_date.localeCompare(b.work_date));
  return persons;
}

export function fetchBizPage(db: DatabaseSync, p: BizQuery, requestedPage: number): BizLookupPage {
  ensureBizAttendanceTable(db);
  const days = Math.max(1, dateRange(p.dateFrom, p.dateTo).length);
  const all = listEmployeeNos(db, p);
  const pageSize = Math.max(1, Math.floor(PAGE_ROW_LIMIT / days));
  const totalPages = all.length === 0 ? 1 : Math.ceil(all.length / pageSize);
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const pageNos = all.slice((page - 1) * pageSize, page * pageSize);
  const persons = fetchPersonsByEmployeeNos(db, p, pageNos);

  const depts = (
    db
      .prepare("SELECT DISTINCT dept FROM biz_attendance WHERE dept IS NOT NULL AND dept != '' ORDER BY dept")
      .all() as { dept: string }[]
  ).map((r) => r.dept);
  const w = buildWhere(p);
  const up = db.prepare(`SELECT MAX(uploaded_at) u FROM biz_attendance WHERE ${w.sql}`).get(...w.args) as {
    u: string | null;
  };
  const range = db.prepare("SELECT MIN(work_date) a, MAX(work_date) b FROM biz_attendance").get() as {
    a: string | null;
    b: string | null;
  };
  return {
    dateFrom: p.dateFrom,
    dateTo: p.dateTo,
    persons,
    totalPersons: all.length,
    page,
    pageSize,
    totalPages,
    depts,
    uploadedAt: up.u,
    dataFrom: range.a,
    dataTo: range.b,
  };
}

/** 엑셀 다운로드용 — 페이지 구분 없이 조건에 맞는 전체 */
export function fetchBizAll(db: DatabaseSync, p: BizQuery): BizPerson[] {
  ensureBizAttendanceTable(db);
  return fetchPersonsByEmployeeNos(db, p, listEmployeeNos(db, p));
}
