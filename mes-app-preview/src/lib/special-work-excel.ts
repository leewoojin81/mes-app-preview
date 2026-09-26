import path from "node:path";
import ExcelJS from "exceljs";
import type { SpecialGridResult } from "@/lib/special-work-grid";

// PSN-05 "특근일" 탭 다운로드(2026-09-26 사용자 요청) — 양식 "2026년 09월 일요일근무(양식).xlsx"의
// "정규세부(급여계산)" 시트처럼 만든다. 작업자 1명당 5행(출근시간/퇴근시간/기본근무 계/연장근무
// 계/급여산출)에 선택한 특근일을 가로 열로 펼치고, 오른쪽에 야간식대/계/TTL, 맨 아래에 열별
// "금액 합계"를 둔다. 양식의 서식(글꼴·테두리·채움색·숫자서식)은 templates/special-work.xlsx
// (원본에서 직원 데이터·메모를 모두 지우고 서식만 남긴 정리본)의 머리글/견본 블록에서 복제해
// 쓴다 — 특근일 개수에 따라 열 수가 달라져 양식 그대로 채우지 않고 새로 배치한다.
//
// 계산(양식 수식과 같은 구조, 엑셀 수식으로 넣어 사람이 시급/시간을 고쳐도 다시 계산된다):
//  - 급여산출(날짜별) = 기본근무*기본시급 + 연장근무*연장시급  (시급은 화면 입력값, 각각 시급×1.5·×2.0)
//  - 계 = 행 합계, TTL = 기본/연장 행은 계×시급, 급여산출 행은 ROUND(날짜별 급여+야간식대)
//  - 야간식대: 화면 패널의 "야간식대" 입력값(nightMealWon, 1회당 원) × 그 작업자의 야간 근무일 수
//    (카드 출근 20:00 이후인 날, night_days). 비워 두면 0원. 급여산출 행의 야간식대 칸에 들어가
//    TTL에 합산된다
//  - 목적은 양식 값이 전부 "생산"이라 고정값
// 양식 오른쪽의 메모/계산예시 표, 도급세부 시트는 옮기지 않는다.

export const SPECIAL_TEMPLATE_PATH = path.join(process.cwd(), "templates", "special-work.xlsx");

const WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

// 출력 열 → 견본 열(서식 복제 원본): A~D 그대로, 날짜열=E, 야간식대=K, 계=L, TTL=M
const PROTO = { date: 5, meal: 11, sum: 12, ttl: 13 };
const TEMPLATE_COLS = 13;

type StyleSnapshot = Partial<ExcelJS.Style>;

function snapshotRow(ws: ExcelJS.Worksheet, rowNo: number): StyleSnapshot[] {
  const row = ws.getRow(rowNo);
  return Array.from({ length: TEMPLATE_COLS }, (_, i) => ({ ...row.getCell(i + 1).style }));
}

function colName(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
function hmFraction(hm: string): number | null {
  const m = hm.match(/^(\d{1,2}):(\d{2})/);
  return m ? (Number(m[1]) * 60 + Number(m[2])) / 1440 : null;
}
function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function specialWorkFilename(dates: string[]): string {
  const first = [...dates].sort()[0] ?? "";
  return `${first.slice(0, 4)}년 ${first.slice(5, 7)}월 특근일근무.xlsx`;
}

export async function buildSpecialWorkbook(
  grid: SpecialGridResult,
  rates: { base: number; overtime: number },
  nightMealWon = 0
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SPECIAL_TEMPLATE_PATH);
  const ws = wb.worksheets[0];

  const header5 = snapshotRow(ws, 5);
  const header6 = snapshotRow(ws, 6);
  const block = [7, 8, 9, 10, 11].map((r) => snapshotRow(ws, r));

  // 견본 영역(5~11행)을 비운다 — 아래에서 protos를 복제해 새로 쓴다.
  for (let r = 5; r <= Math.max(ws.rowCount, 11); r++) {
    for (let c = 1; c <= TEMPLATE_COLS; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.value = null;
      cell.style = {};
    }
  }

  const n = grid.dates.length;
  const firstDateCol = 5;
  const mealCol = firstDateCol + n;
  const sumCol = mealCol + 1;
  const ttlCol = sumCol + 1;
  const lastCol = ttlCol;
  const protoOf = (outCol: number): number =>
    outCol <= 4 ? outCol : outCol < mealCol ? PROTO.date : outCol === mealCol ? PROTO.meal : outCol === sumCol ? PROTO.sum : PROTO.ttl;
  const styleAt = (snap: StyleSnapshot[], outCol: number): StyleSnapshot => ({ ...snap[protoOf(outCol) - 1] });

  const setCell = (rowNo: number, col: number, snap: StyleSnapshot[], value: ExcelJS.CellValue, numFmt?: string) => {
    const cell = ws.getRow(rowNo).getCell(col);
    cell.style = styleAt(snap, col);
    if (numFmt) cell.numFmt = numFmt;
    cell.value = value;
  };

  // ── 머리글(5~6행) ──
  const labels = ["목적", "공정", "성명", "구분"];
  for (let c = 1; c <= lastCol; c++) {
    setCell(5, c, header5, null);
    setCell(6, c, header6, null);
  }
  labels.forEach((label, i) => {
    ws.getRow(5).getCell(i + 1).value = label;
    ws.mergeCells(5, i + 1, 6, i + 1);
  });
  grid.dates.forEach((d, j) => {
    const col = firstDateCol + j;
    ws.getRow(5).getCell(col).value = utcDate(d);
    const dow = utcDate(d).getUTCDay();
    const wd = ws.getRow(6).getCell(col);
    wd.value = WEEKDAYS[dow];
    wd.font = { ...(wd.font ?? {}), color: { argb: dow === 0 ? "FFFF0000" : dow === 6 ? "FF0000FF" : "FF000000" } };
  });
  for (const [col, label] of [
    [mealCol, "야간식대"],
    [sumCol, "계"],
    [ttlCol, "TTL"],
  ] as const) {
    ws.getRow(5).getCell(col).value = label;
    ws.mergeCells(5, col, 6, col);
  }

  // ── 작업자 블록(5행씩) ──
  let r = 7;
  const payRows: number[] = [];
  for (const w of grid.workers) {
    const r0 = r;
    const [rIn, rOut, rBase, rOt, rPay] = [r0, r0 + 1, r0 + 2, r0 + 3, r0 + 4];
    const dLabels = ["출근시간", "퇴근시간", "기본근무 계", "연장근무 계", "급여산출"];
    for (let i = 0; i < 5; i++) {
      for (let c = 1; c <= lastCol; c++) setCell(r0 + i, c, block[i], null);
      ws.getRow(r0 + i).getCell(4).value = dLabels[i];
    }
    // A~C: 첫 행은 값, 나머지 행은 양식처럼 윗행 참조 수식(=A7)
    const abc: [number, string][] = [
      [1, "생산"],
      [2, w.process || "-"],
      [3, w.name],
    ];
    for (const [col, val] of abc) {
      ws.getRow(rIn).getCell(col).value = val;
      for (let i = 1; i < 5; i++) {
        ws.getRow(r0 + i).getCell(col).value = { formula: `${colName(col)}${r0 + i - 1}`, result: val };
      }
    }

    const datePays: number[] = [];
    let baseSum = 0;
    let otSum = 0;
    grid.dates.forEach((d, j) => {
      const col = firstDateCol + j;
      const L = colName(col);
      const cell = w.cells[d];
      if (cell) {
        const inF = hmFraction(cell.in_time);
        const outF = hmFraction(cell.out_time);
        if (inF !== null) ws.getRow(rIn).getCell(col).value = inF;
        if (outF !== null) ws.getRow(rOut).getCell(col).value = outF;
        if (cell.base) ws.getRow(rBase).getCell(col).value = cell.base;
        if (cell.overtime) ws.getRow(rOt).getCell(col).value = cell.overtime;
        baseSum += cell.base;
        otSum += cell.overtime;
      }
      const pay = (cell?.base ?? 0) * rates.base + (cell?.overtime ?? 0) * rates.overtime;
      datePays.push(pay);
      ws.getRow(rPay).getCell(col).value = {
        formula: `IFERROR((${L}${rBase}*${rates.base})+(${L}${rOt}*${rates.overtime}),"")`,
        result: pay,
      };
    });

    const mealTotal = w.night_days * nightMealWon;
    if (mealTotal > 0) ws.getRow(rPay).getCell(mealCol).value = mealTotal;

    const firstL = colName(firstDateCol);
    const lastL = colName(mealCol);
    const sumL = colName(sumCol);
    ws.getRow(rBase).getCell(sumCol).value = { formula: `SUM(${firstL}${rBase}:${lastL}${rBase})`, result: baseSum };
    ws.getRow(rOt).getCell(sumCol).value = { formula: `SUM(${firstL}${rOt}:${lastL}${rOt})`, result: otSum };
    ws.getRow(rPay).getCell(sumCol).value = { formula: `SUM(${sumL}${rBase}:${sumL}${rOt})`, result: baseSum + otSum };
    ws.getRow(rBase).getCell(ttlCol).value = { formula: `${sumL}${rBase}*${rates.base}`, result: baseSum * rates.base };
    ws.getRow(rOt).getCell(ttlCol).value = { formula: `${sumL}${rOt}*${rates.overtime}`, result: otSum * rates.overtime };
    ws.getRow(rPay).getCell(ttlCol).value = {
      formula: `ROUND(SUM(${firstL}${rPay}:${lastL}${rPay}),0)`,
      result: Math.round(datePays.reduce((a, b) => a + b, 0) + mealTotal),
    };
    payRows.push(rPay);
    r += 5;
  }

  // ── 금액 합계 행: 열별로 각 작업자의 "급여산출" 행만 합산(양식의 SUMIFS와 같음) ──
  const totalRow = r;
  for (let c = 1; c <= lastCol; c++) setCell(totalRow, c, block[4], null);
  for (let c = 1; c <= 3; c++) {
    const cell = ws.getRow(totalRow).getCell(c);
    cell.style = { ...header5[Math.min(c, 4) - 1] };
  }
  ws.getRow(totalRow).getCell(1).value = "금액 합계";
  ws.mergeCells(totalRow, 1, totalRow, 3);
  ws.getRow(totalRow).getCell(4).value = "급여산출";
  for (let c = firstDateCol; c <= lastCol; c++) {
    const L = colName(c);
    const result = payRows.reduce((acc, pr) => {
      const v = ws.getRow(pr).getCell(c).value;
      const num = typeof v === "number" ? v : v && typeof v === "object" && "result" in v ? Number((v as { result?: unknown }).result) || 0 : 0;
      return acc + num;
    }, 0);
    ws.getRow(totalRow).getCell(c).value = {
      formula: `SUMIFS(${L}$7:${L}${totalRow - 1},$D$7:$D${totalRow - 1},$D$${totalRow})`,
      result,
    };
  }

  // ── 열 너비·행 높이·고정·인쇄 ──
  const widths: Record<number, number> = { 1: 8.1, 2: 9.1, 3: 9.1, 4: 11.5 };
  for (let c = 1; c <= lastCol; c++) {
    ws.getColumn(c).width = widths[c] ?? (c === ttlCol ? 13.4 : c === firstDateCol - 0 || c < mealCol ? 10 : 9.1);
  }
  // 견본에 남아 있던 오른쪽 메모 열(양식의 계산예시 표 자리)의 열 너비는 쓰지 않는다.
  for (let c = lastCol + 1; c <= 26; c++) ws.getColumn(c).width = undefined;
  for (let rr = 5; rr <= totalRow; rr++) ws.getRow(rr).height = 16.5;
  ws.views = [{ state: "frozen", xSplit: 4, ySplit: 6, showGridLines: true }];
  ws.pageSetup.printArea = `A1:${colName(lastCol)}${totalRow}`;
  ws.pageSetup.orientation = "landscape";

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
