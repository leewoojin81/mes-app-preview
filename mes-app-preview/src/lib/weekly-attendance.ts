import type { DatabaseSync } from "node:sqlite";
import path from "node:path";
import ExcelJS from "exceljs";
import { isKrPublicHoliday } from "@/lib/kr-holidays";
import { formatBizName } from "@/lib/biz-import";
import type { CalendarDayType } from "@/lib/types";

// 근무시간조회(PSN-05) "공정별 주간 근태" 다운로드(2026-09-26 사용자 요청) — 실제 제출용
// 서식 "공정별 주간 근태_26.09.01~09.06.xlsx"(templates/weekly-attendance.xlsx)를 그대로
// 열어 각 시트의 데이터 영역(9행~)만 지우고 PSN-01(일일근태입력)/PSN-02(출퇴근카드)
// 값으로 다시 채운다 — 병합·열너비·인쇄영역·숨김시트 같은 서식은 서식 파일 것을 그대로
// 쓰려고 xlsx(SheetJS 무료판, 스타일 유지 못 함) 대신 exceljs를 쓴다. 기간은 화면 조회기간을
// 그대로 쓴다(2026-09-26 사용자 요청 — 처음엔 월~일 한 주 고정이었으나 조회기간대로 바뀜).
//
// 컬럼별 출처(2026-09-01~06 주 실제 양식 514행을 DB와 대조해 맞춘 규칙):
//  - 사번/부서/성명: 작업자등록의 비즈 사번·비즈 부서·비즈 이름 표기(초과신청 다운로드와 동일).
//    직책이 "조장"이면 "조장-" 접두, "알바"면 "(알바)" 접미(양식 표기 관례)
//  - 직위/출근·퇴근 일자·시간: PSN-02 카드(직급/출근시간/퇴근시간). 퇴근시간이 출근시간보다
//    이르면 자정을 넘긴 것이라 퇴근일자는 다음날
//  - 타임: 그날 카드 출근시간이 12시 이후면 2조, 아니면 1조(카드가 없으면 작업자등록 근무조).
//    시트(주/야)는 그 주에 더 많이 나온 조로 정한다
//  - 지각: PSN-02 지각시간(없으면 PSN-01 지각), 조퇴: PSN-01 조퇴
//  - 조출/중교/정근: PSN-01 조출/중식교대/정상. 연장 = 잔업+조출+중교(양식 규칙 — 잔업 칸은 비워둠)
//  - 야간: 1조는 조출시간 중 05:00~06:00분(조출시간-1시간), 2조는 22:15~01:00(2:45) —
//    근무시간정보(PSN-07)의 조출 구간/3Q 구간 기준
//  - 토·일·공휴일(휴일 캘린더 포함)에 일한 날은 정근 대신 특근=정상, 특연(토요/휴일)=연장분이고
//    조출·중교 칸은 비운다. 비고에 "특근"
//  - 정근: PSN-01 저장값. PSN-01에 저장분이 없는 평일은 PSN-01 화면처럼 8시간
//  - 비고: 휴가(연차/공가/오전·오후반차)·특근·지각·조퇴·누락서(카드 출근/퇴근 판정이 비어 있는
//    날)·결근. 양식에 사람이 손으로 적던 사유(입사, 지각(미제출) 등)는 만들 수 없어 비워 둔다

export const WEEKLY_TEMPLATE_PATH = path.join(process.cwd(), "templates", "weekly-attendance.xlsx");

const DATA_START_ROW = 9;
const MAX_COL = 24;
const NIGHT_HOURS_SHIFT2 = 2.75;

// ── 날짜 유틸 ────────────────────────────────────────────────────────────
function parseUtc(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}
function fmtUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(s: string, n: number): string {
  return fmtUtc(new Date(parseUtc(s).getTime() + n * 86400000));
}

/** "공정별 주간 근태_26.08.31~09.06.xlsx" — 연도가 걸치면 끝도 연도를 붙인다. */
export function weeklyFilename(dates: string[]): string {
  const [from, to] = [dates[0], dates[dates.length - 1]];
  const f = `${from.slice(2, 4)}.${from.slice(5, 7)}.${from.slice(8, 10)}`;
  const t =
    from.slice(0, 4) === to.slice(0, 4)
      ? `${to.slice(5, 7)}.${to.slice(8, 10)}`
      : `${to.slice(2, 4)}.${to.slice(5, 7)}.${to.slice(8, 10)}`;
  return `공정별 주간 근태_${f}~${t}.xlsx`;
}

// ── 값 변환 ──────────────────────────────────────────────────────────────
function hoursToMinutes(h: number | null | undefined): number {
  return h ? Math.round(h * 60) : 0;
}
function hmToMinutes(s: unknown): number {
  const m = String(s ?? "").match(/^(\d+):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
function minutesToHm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// ── 데이터 조립 ──────────────────────────────────────────────────────────
interface WorkerRow {
  employee_no: string;
  biz_employee_no: string | null;
  worker_name: string;
  contractor: string | null;
  work_group: string | null;
  biz_dept: string | null;
  team: string | null;
  duty: string | null;
}
interface DailyRec {
  employee_no: string;
  work_date: string;
  leave_type: string | null;
  normal_hours: number;
  overtime_hours: number;
  early_start_hours: number;
  lunch_shift_hours: number;
  late_hours: number;
  early_leave_hours: number;
  total_hours: number;
}

/** 시트 한 행(작업자 1명의 하루) — 분 단위 값은 0이면 빈칸으로 쓴다. */
interface DayLine {
  date: string;
  timeLabel: string;
  inDate: string;
  inTime: string;
  outDate: string;
  outTime: string;
  lateMin: number;
  earlyLeaveMin: number;
  earlyStartMin: number;
  lunchMin: number;
  overtimeMin: number; // 잔업 칸(양식 규칙상 항상 0 — 연장에 합산)
  normalMin: number;
  extMin: number;
  nightMin: number;
  specialMin: number; // 특근
  specialHolidayMin: number; // 특연 휴일
  specialSatMin: number; // 특연 토요
  note: string;
}
interface WorkerBlock {
  bizNo: string;
  dept: string;
  shift: "1조" | "2조";
  name: string;
  position: string;
  lines: DayLine[];
}

const LEAVE_NOTE: Record<string, string> = { 연차: "연차", 공가: "공가", 전반: "오전반차", 후반: "오후반차" };
const FULL_DAY_LEAVE = new Set(["연차", "공가", "휴무"]);

function isOffDay(date: string, calType: CalendarDayType | undefined): boolean {
  if (calType) return calType !== "평일";
  const dow = parseUtc(date).getUTCDay();
  return dow === 0 || dow === 6 || isKrPublicHoliday(date);
}

// 양식의 성명 표기 — 비즈 이름(도급사 접두) + 직책 관례(조장-이름, 이름(알바)).
function displayName(w: WorkerRow): string {
  const base = formatBizName(w.worker_name, w.contractor);
  if (w.duty === "조장" && base === w.worker_name) return `조장-${base}`;
  if (w.duty === "알바") return `${base}(알바)`;
  return base;
}

export function buildWeeklyBlocks(
  db: DatabaseSync,
  employeeNos: string[],
  dates: string[]
): WorkerBlock[] {
  if (employeeNos.length === 0) return [];
  const from = dates[0];
  const to = dates[dates.length - 1];
  const ph = employeeNos.map(() => "?").join(",");

  const workers = db
    .prepare(
      `SELECT employee_no, biz_employee_no, worker_name, contractor, work_group, biz_dept, team, duty
       FROM workers WHERE employee_no IN (${ph})`
    )
    .all(...employeeNos) as unknown as WorkerRow[];

  const dailyRows = db
    .prepare(
      `SELECT employee_no, work_date, leave_type, normal_hours, overtime_hours, early_start_hours,
              lunch_shift_hours, late_hours, early_leave_hours, total_hours
       FROM work_hours_daily WHERE employee_no IN (${ph}) AND work_date BETWEEN ? AND ?`
    )
    .all(...employeeNos, from, to) as unknown as DailyRec[];
  const dailyByKey = new Map(dailyRows.map((r) => [`${r.employee_no}|${r.work_date}`, r]));

  // 카드 사원번호는 비즈 사번(13자리)이라 workers.biz_employee_no로 잇는다(없으면 우리 사번).
  const cardKeys = new Set<string>();
  for (const w of workers) {
    cardKeys.add(w.biz_employee_no ?? w.employee_no);
    cardKeys.add(w.employee_no);
  }
  const cardRows = db
    .prepare("SELECT employee_no, work_date, detail FROM attendance_card_status WHERE work_date BETWEEN ? AND ?")
    .all(from, to) as unknown as { employee_no: string | null; work_date: string | null; detail: string | null }[];
  const cardByKey = new Map<string, Record<string, string | number | null>>();
  for (const r of cardRows) {
    if (!r.employee_no || !r.work_date || !cardKeys.has(r.employee_no) || !r.detail) continue;
    try {
      cardByKey.set(`${r.employee_no}|${r.work_date}`, JSON.parse(r.detail));
    } catch {
      /* 깨진 detail은 무시 */
    }
  }

  const calRows = db
    .prepare("SELECT cal_date, day_type FROM production_calendar WHERE cal_date BETWEEN ? AND ?")
    .all(from, to) as unknown as { cal_date: string; day_type: CalendarDayType }[];
  const calendar = new Map(calRows.map((r) => [r.cal_date, r.day_type]));

  const blocks: WorkerBlock[] = [];
  for (const w of workers) {
    const bizNo = w.biz_employee_no ?? w.employee_no;
    const dept = (w.biz_dept ?? w.work_group ?? "").trim();
    const cardOf = (d: string) => cardByKey.get(`${bizNo}|${d}`) ?? cardByKey.get(`${w.employee_no}|${d}`);

    const lines: DayLine[] = [];
    let position = "";
    const registeredShift: "1조" | "2조" | null = w.team === "1조" || w.team === "2조" ? w.team : null;
    const shiftCount = { "1조": 0, "2조": 0 };

    for (const date of dates) {
      const rec = dailyByKey.get(`${w.employee_no}|${date}`);
      const card = cardOf(date);
      const cardIn = String(card?.["출근시간"] ?? "").trim();
      const cardOut = String(card?.["퇴근시간"] ?? "").trim();
      if (card && !position) position = String(card["직급"] ?? "").trim();
      const leave = rec?.leave_type ?? "";
      const off = isOffDay(date, calendar.get(date));
      const worked = cardIn !== "" || ((rec?.total_hours ?? 0) > 0 && !FULL_DAY_LEAVE.has(leave));

      // 평일(휴일 아님)은 기록이 하나라도 있으면 행을 만들고(연차·결근도 양식에 나옴),
      // 휴일은 실제로 일한 날만 만든다.
      if (off ? !worked : !rec && !card) continue;
      if (!off && leave === "휴무" && !worked) continue;

      const lineShift: "1조" | "2조" = cardIn
        ? Number(cardIn.slice(0, 2)) >= 12
          ? "2조"
          : "1조"
        : (registeredShift ?? "1조");
      shiftCount[lineShift]++;

      const earlyMin = hoursToMinutes(rec?.early_start_hours);
      const lunchMin = hoursToMinutes(rec?.lunch_shift_hours);
      const ovtMin = hoursToMinutes(rec?.overtime_hours);
      // PSN-01에 저장분이 없는 평일은 PSN-01 화면과 똑같이 기본 8시간으로 본다.
      const normalMin = rec ? hoursToMinutes(rec.normal_hours) : off ? 0 : 480;
      const extMin = ovtMin + earlyMin + lunchMin;
      const lateMin = hmToMinutes(card?.["지각시간"]) || hoursToMinutes(rec?.late_hours);
      const earlyLeaveMin = hoursToMinutes(rec?.early_leave_hours);
      const nightMin = !worked
        ? 0
        : lineShift === "2조"
          ? Math.round(NIGHT_HOURS_SHIFT2 * 60)
          : Math.max(0, earlyMin - 60);

      let outDate = date;
      if (cardIn && cardOut && cardOut < cardIn) outDate = addDays(date, 1);

      const notes: string[] = [];
      if (off && worked) notes.push("특근");
      if (LEAVE_NOTE[leave]) notes.push(LEAVE_NOTE[leave]);
      if (!off && rec && !worked && !leave && normalMin === 0 && !card) notes.push("결근");
      if (!off && lateMin > 0) notes.push("지각");
      if (!off && earlyLeaveMin > 0) notes.push("조퇴");
      // 카드에 시각은 있어도 판정이 비어 있으면(출근/퇴근 태깅이 빠져 수정된 날) 누락서 대상
      if (!off && card && !LEAVE_NOTE[leave] && !FULL_DAY_LEAVE.has(leave)) {
        const noIn = !String(card["출근판정"] ?? "").trim();
        const noOut = !String(card["퇴근판정"] ?? "").trim();
        if (noIn && noOut) notes.push("누락서(출퇴)");
        else if (noIn) notes.push("누락서(출근)");
        else if (noOut) notes.push("누락서(퇴근)");
      }

      const isSat = parseUtc(date).getUTCDay() === 6;
      lines.push({
        date,
        timeLabel: lineShift,
        // 날짜 칸은 카드가 없는 날(연차·결근·카드 미업로드)에도 근무일자로 채운다 — 양식에서
        // 행의 날짜를 알려주는 유일한 칸이라 비우면 어느 날인지 알 수 없다. 시각만 카드값.
        inDate: date,
        inTime: cardIn,
        outDate,
        outTime: cardOut,
        lateMin,
        earlyLeaveMin,
        earlyStartMin: off ? 0 : earlyMin,
        lunchMin: off ? 0 : lunchMin,
        overtimeMin: 0,
        normalMin: off ? 0 : normalMin,
        extMin: off ? 0 : extMin,
        nightMin,
        specialMin: off ? normalMin : 0,
        specialHolidayMin: off && !isSat ? extMin : 0,
        specialSatMin: off && isSat ? extMin : 0,
        note: notes.join(", "),
      });
    }
    if (lines.length === 0) continue;
    blocks.push({
      bizNo,
      dept,
      shift: shiftCount["2조"] > shiftCount["1조"] ? "2조" : shiftCount["2조"] === shiftCount["1조"] && registeredShift === "2조" ? "2조" : "1조",
      name: displayName(w),
      position,
      lines,
    });
  }
  blocks.sort((a, b) => a.bizNo.localeCompare(b.bizNo));
  return blocks;
}

// ── 시트 매칭 ────────────────────────────────────────────────────────────
// 시트 이름의 "주"/"야" 표기로 어느 조 시트인지 정한다(둘 다 있거나 둘 다 없으면 조 무관).
// 부서는 시트 A4의 "부서 : 2층시급직. 착색(패드)"에서 마지막 ". " 뒤를 쓴다.
function sheetDept(ws: ExcelJS.Worksheet): string {
  const a4 = String(ws.getCell("A4").value ?? "");
  const i = a4.lastIndexOf(". ");
  return (i >= 0 ? a4.slice(i + 2) : a4.replace(/^부서\s*:\s*/, "")).trim();
}
function sheetShift(ws: ExcelJS.Worksheet): "day" | "night" | "both" {
  const hasDay = ws.name.includes("주");
  const hasNight = ws.name.includes("야");
  if (hasDay === hasNight) return "both";
  return hasDay ? "day" : "night";
}

// ── 서식 채우기 ──────────────────────────────────────────────────────────
type StyleSnapshot = Partial<ExcelJS.Style>;
function snapshotRow(ws: ExcelJS.Worksheet, rowNo: number): StyleSnapshot[] {
  const row = ws.getRow(rowNo);
  return Array.from({ length: MAX_COL }, (_, i) => ({ ...row.getCell(i + 1).style }));
}
function findSubtotalRow(ws: ExcelJS.Worksheet): number {
  for (let r = DATA_START_ROW; r <= ws.rowCount; r++) {
    if (String(ws.getCell(r, 1).value ?? "").includes("소 계")) return r;
  }
  return -1;
}

const COL = { A: 1, B: 2, C: 3, D: 4, E: 5, G: 7, H: 8, I: 9, J: 10, K: 11, L: 12, N: 14, O: 15, P: 16, Q: 17, R: 18, S: 19, T: 20, U: 21, V: 22, W: 23 };
const FMT_TEXT = "@";
const FMT_DUR = "[hh]:mm";
const FMT_TIME = "h:mm";

const ymdSlash = (s: string) => s.replace(/-/g, "/");

export interface WeeklyFillResult {
  buffer: ArrayBuffer;
  unassigned: string[]; // 시트를 못 찾아 빠진 작업자(사번 부서)
}

export async function fillWeeklyTemplate(
  blocks: WorkerBlock[],
  dates: string[],
  printedOn: string
): Promise<WeeklyFillResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WEEKLY_TEMPLATE_PATH);

  const period = `근무기간 : ${ymdSlash(dates[0])} - ${ymdSlash(dates[dates.length - 1])}`;
  const printed = `출력일자 : ${ymdSlash(printedOn)}`;

  const sheets = wb.worksheets.map((ws) => ({ ws, dept: sheetDept(ws), shift: sheetShift(ws) }));
  const assigned = new Map<ExcelJS.Worksheet, WorkerBlock[]>();
  const unassigned: string[] = [];
  for (const b of blocks) {
    const cands = sheets.filter((s) => s.dept === b.dept && s.ws.rowCount >= DATA_START_ROW && findSubtotalRow(s.ws) > 0);
    const want = b.shift === "2조" ? "night" : "day";
    const target = cands.find((s) => s.shift === want) ?? cands.find((s) => s.shift === "both") ?? cands[0];
    if (!target) {
      unassigned.push(`${b.bizNo} ${b.name}(${b.dept || "부서없음"})`);
      continue;
    }
    if (!assigned.has(target.ws)) assigned.set(target.ws, []);
    assigned.get(target.ws)!.push(b);
  }

  for (const { ws } of sheets) {
    ws.getCell("E4").value = period;
    ws.getCell("E5").value = printed;

    const subRowNo = findSubtotalRow(ws);
    if (subRowNo < 0) continue; // "근태수정"처럼 데이터 영역이 없는 시트는 머리글 날짜만 갱신

    const dataStyle = snapshotRow(ws, DATA_START_ROW);
    const subStyle = snapshotRow(ws, subRowNo);
    const rowHeight = ws.getRow(DATA_START_ROW).height;
    // 기존 데이터 영역을 비운다 — spliceRows는 값이 남거나 행이 뒤섞여(2026-09-26 실측:
    // 소계행에 이전 행 날짜가 새고 같은 사번이 두 번 나옴) 셀 값/스타일을 직접 지운다.
    const oldLast = ws.rowCount;
    for (let rr = DATA_START_ROW; rr <= oldLast; rr++) {
      const row = ws.getRow(rr);
      for (let c = 1; c <= MAX_COL; c++) {
        const cell = row.getCell(c);
        cell.value = null;
        cell.style = {};
      }
    }

    let r = DATA_START_ROW;
    const put = (row: ExcelJS.Row, styles: StyleSnapshot[]) => {
      for (let c = 1; c <= MAX_COL; c++) row.getCell(c).style = { ...styles[c - 1] };
      if (rowHeight) row.height = rowHeight;
    };
    const setDur = (row: ExcelJS.Row, col: number, min: number) => {
      const cell = row.getCell(col);
      cell.numFmt = FMT_DUR;
      if (min > 0) cell.value = min / 1440;
    };

    const list = assigned.get(ws) ?? [];
    for (const b of list) {
      const tot = { late: 0, leave: 0, N: 0, O: 0, P: 0, Q: 0, R: 0, S: 0, T: 0, U: 0, V: 0 };
      let inCnt = 0;
      let outCnt = 0;
      b.lines.forEach((l, idx) => {
        const row = ws.getRow(r++);
        put(row, dataStyle);
        const text = (col: number, v: string) => {
          const cell = row.getCell(col);
          cell.numFmt = FMT_TEXT;
          cell.value = v;
        };
        if (idx === 0) {
          text(COL.A, b.bizNo);
          text(COL.B, b.dept);
          text(COL.C, b.name);
          text(COL.D, b.position);
        }
        text(COL.E, l.timeLabel);
        text(COL.G, l.inDate);
        text(COL.H, l.inTime);
        text(COL.I, l.outDate);
        text(COL.J, l.outTime);
        if (l.inTime) inCnt++;
        if (l.outTime) outCnt++;
        text(COL.K, l.lateMin > 0 ? minutesToHm(l.lateMin) : "");
        const leaveCell = row.getCell(COL.L);
        leaveCell.numFmt = FMT_TIME;
        if (l.earlyLeaveMin > 0) leaveCell.value = l.earlyLeaveMin / 1440;
        setDur(row, COL.N, l.earlyStartMin);
        setDur(row, COL.O, l.lunchMin);
        setDur(row, COL.P, l.overtimeMin);
        setDur(row, COL.Q, l.normalMin);
        setDur(row, COL.R, l.extMin);
        setDur(row, COL.S, l.nightMin);
        setDur(row, COL.T, l.specialMin);
        setDur(row, COL.U, l.specialHolidayMin);
        setDur(row, COL.V, l.specialSatMin);
        text(COL.W, l.note);
        tot.late += l.lateMin;
        tot.leave += l.earlyLeaveMin;
        tot.N += l.earlyStartMin;
        tot.O += l.lunchMin;
        tot.P += l.overtimeMin;
        tot.Q += l.normalMin;
        tot.R += l.extMin;
        tot.S += l.nightMin;
        tot.T += l.specialMin;
        tot.U += l.specialHolidayMin;
        tot.V += l.specialSatMin;
      });

      // 소계행 — 양식대로 E/H/J는 행 수(문자열), K는 "hh:mm" 문자열, 나머지는 시간 합계.
      const sub = ws.getRow(r++);
      put(sub, subStyle);
      const subText = (col: number, v: string) => {
        const cell = sub.getCell(col);
        cell.numFmt = FMT_TEXT;
        cell.value = v;
      };
      subText(COL.A, "( 소 계 )");
      subText(COL.E, String(b.lines.length));
      subText(COL.H, String(inCnt));
      subText(COL.J, String(outCnt));
      subText(COL.K, minutesToHm(tot.late));
      const subLeave = sub.getCell(COL.L);
      subLeave.numFmt = FMT_TIME;
      subLeave.value = tot.leave / 1440;
      for (const [col, key] of [
        [COL.N, "N"],
        [COL.O, "O"],
        [COL.P, "P"],
        [COL.Q, "Q"],
        [COL.R, "R"],
        [COL.S, "S"],
        [COL.T, "T"],
        [COL.U, "U"],
        [COL.V, "V"],
      ] as const) {
        const cell = sub.getCell(col);
        cell.numFmt = FMT_DUR;
        cell.value = tot[key] / 1440;
      }
    }

    ws.pageSetup.printArea = `A1:W${Math.max(r - 1, DATA_START_ROW - 1)}`;
    // 숨김 처리돼 있던 시트도 이번 주에 데이터가 생기면 보이게 한다.
    if (list.length > 0 && ws.state !== "visible") ws.state = "visible";
  }

  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return { buffer, unassigned };
}
