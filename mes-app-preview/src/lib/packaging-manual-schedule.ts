import type { DatabaseSync } from "node:sqlite";
import * as XLSX from "xlsx";
import {
  addDays,
  p410BySo,
  PACKAGING_LINES,
  splitSoNos,
  type PackagingCell,
  type PackagingDayActual,
  type PackagingScheduleResult,
} from "@/lib/packaging-schedule";

// 계획정보(PLAN-03) "일정(수기)" — 담당자가 엑셀("2026년 포장_날짜.xlsx" 1번 시트)에 직접 적은 포장 일정을 업로드해서 그대로 보여준다
// (2026-10-05 사용자 요청). "일정(계획)" 탭은 수주번호로 값을 읽어 계산하지만, 이쪽은 엑셀에 적힌 품명·계획·개입수·고객사·납기일·
// 수주번호를 읽은 값 그대로 보여주는 별도 데이터이며 서로 영향을 주지 않는다.

export function ensureManualScheduleTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS packaging_manual_schedule (
      plan_date TEXT NOT NULL,
      line_key TEXT NOT NULL,
      product_name TEXT,
      plan_qty REAL,
      pack_size TEXT,
      customer TEXT,
      due_date TEXT,
      so_no TEXT,
      PRIMARY KEY (plan_date, line_key)
    );
    CREATE TABLE IF NOT EXISTS packaging_manual_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      file_name TEXT,
      date_from TEXT,
      date_to TEXT,
      cell_count INTEGER,
      uploaded_by TEXT,
      uploaded_at TEXT
    );
  `);
}

export interface ManualCell {
  plan_date: string;
  line_key: string;
  product_name: string | null;
  plan_qty: number | null;
  pack_size: string | null;
  customer: string | null;
  due_date: string | null;
  so_no: string | null;
}

export interface ManualParsed {
  cells: ManualCell[];
  dateFrom: string;
  dateTo: string;
  sheetName: string;
}

function isoFromSerial(n: number): string {
  return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
}
function text(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\r?\n/g, " ").trim();
  return s === "" ? null : s;
}
/** 엑셀 날짜(일련번호·"2026.10.07"·"2026-10-07")를 YYYY-MM-DD로, 그 외 글자는 그대로 */
function toIsoDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v > 30000 && v < 80000 ? isoFromSerial(v) : String(v);
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : s || null;
}
/** "1 Line Auto (Monthly)" → line1, "바이알…" → vial, 그 밖(기타 등)은 null */
function lineKeyOfLabel(label: string): string | null {
  const t = label.trim();
  const m = /^(\d)\s*Line/i.exec(t);
  if (m) {
    const key = `line${m[1]}`;
    return PACKAGING_LINES.some((l) => l.key === key) ? key : null;
  }
  return t.startsWith("바이알") ? "vial" : null;
}

const FIELD_BY_LABEL: Record<string, "product_name" | "plan_qty" | "pack_size" | "customer" | "due_date" | "so_no"> = {
  품명: "product_name",
  계획: "plan_qty",
  개입수: "pack_size",
  고객사: "customer",
  납기일: "due_date",
  수주번호: "so_no",
};

/**
 * 엑셀을 읽는다 — 이름이 "1"인 시트(없으면 첫 시트)에서 "설비"·"구분" 머리글 줄을 찾고, 그 오른쪽 열들의 날짜를 읽은 뒤
 * 설비 블록(1 Line … 바이알)마다 품명·계획·개입수·고객사·납기일·수주번호 줄의 값을 날짜 칸별로 모은다.
 * 실적·단상자·팩수 줄과 "기타" 블록은 가져오지 않는다.
 */
export function parseManualWorkbook(buf: Buffer): ManualParsed {
  const names = XLSX.read(buf, { type: "buffer", bookSheets: true }).SheetNames;
  const sheetName = names.includes("1") ? "1" : names[0];
  if (!sheetName) throw new Error("엑셀에 시트가 없습니다.");
  const wb = XLSX.read(buf, { type: "buffer", sheets: [sheetName] });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`시트 "${sheetName}"를 읽을 수 없습니다.`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as unknown[][];

  // 머리글 줄: "구분" 칸이 있고 그 왼쪽이 "설비"
  let hRow = -1;
  let cLabel = -1;
  for (let r = 0; r < Math.min(rows.length, 20) && hRow === -1; r++) {
    const row = rows[r] ?? [];
    for (let c = 1; c < row.length; c++) {
      if (text(row[c]) === "구분" && text(row[c - 1]) === "설비") {
        hRow = r;
        cLabel = c;
        break;
      }
    }
  }
  if (hRow === -1) throw new Error('"설비"·"구분" 머리글을 찾을 수 없습니다. (2026년 포장 엑셀 1번 시트 양식인지 확인하세요)');

  const dateCols: { c: number; date: string }[] = [];
  const hdr = rows[hRow] ?? [];
  for (let c = cLabel + 1; c < hdr.length; c++) {
    const d = typeof hdr[c] === "number" ? toIsoDate(hdr[c]) : null;
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) dateCols.push({ c, date: d });
  }
  if (dateCols.length === 0) throw new Error("머리글 줄에서 날짜를 찾을 수 없습니다.");

  const byKey = new Map<string, ManualCell>();
  let lineKey: string | null = null;
  for (let r = hRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const block = text(row[cLabel - 1]);
    if (block) lineKey = lineKeyOfLabel(block);
    if (!lineKey) continue;
    const field = FIELD_BY_LABEL[text(row[cLabel]) ?? ""];
    if (!field) continue;
    for (const { c, date } of dateCols) {
      const v = row[c];
      if (v == null || (typeof v === "string" && v.trim() === "")) continue;
      const key = `${date}|${lineKey}`;
      const cell =
        byKey.get(key) ??
        { plan_date: date, line_key: lineKey, product_name: null, plan_qty: null, pack_size: null, customer: null, due_date: null, so_no: null };
      if (field === "plan_qty") {
        const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
        cell.plan_qty = Number.isFinite(n) ? n : null;
      } else if (field === "due_date") {
        cell.due_date = toIsoDate(v);
      } else {
        cell[field] = text(v);
      }
      byKey.set(key, cell);
    }
  }
  const dates = dateCols.map((d) => d.date).sort();
  return { cells: [...byKey.values()], dateFrom: dates[0], dateTo: dates[dates.length - 1], sheetName };
}

/** 파일의 날짜 구간(최소~최대)에 있던 기존 수기 일정을 지우고 파일 내용으로 바꾼다(구간 밖 날짜는 유지) */
export function importManualSchedule(
  db: DatabaseSync,
  parsed: ManualParsed,
  fileName: string,
  user: string | null
): { deleted: number; inserted: number } {
  ensureManualScheduleTables(db);
  const insert = db.prepare(
    `INSERT INTO packaging_manual_schedule (plan_date, line_key, product_name, plan_qty, pack_size, customer, due_date, so_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.exec("BEGIN");
  try {
    const deleted = (
      db.prepare("SELECT COUNT(*) c FROM packaging_manual_schedule WHERE plan_date BETWEEN ? AND ?").get(parsed.dateFrom, parsed.dateTo) as { c: number }
    ).c;
    db.prepare("DELETE FROM packaging_manual_schedule WHERE plan_date BETWEEN ? AND ?").run(parsed.dateFrom, parsed.dateTo);
    for (const c of parsed.cells) {
      insert.run(c.plan_date, c.line_key, c.product_name, c.plan_qty, c.pack_size, c.customer, c.due_date, c.so_no);
    }
    db.prepare(
      `INSERT INTO packaging_manual_meta (id, file_name, date_from, date_to, cell_count, uploaded_by, uploaded_at)
       VALUES (1, ?, ?, ?, ?, ?, datetime('now','localtime'))
       ON CONFLICT(id) DO UPDATE SET file_name = excluded.file_name, date_from = excluded.date_from, date_to = excluded.date_to,
         cell_count = excluded.cell_count, uploaded_by = excluded.uploaded_by, uploaded_at = excluded.uploaded_at`
    ).run(fileName, parsed.dateFrom, parsed.dateTo, parsed.cells.length, user);
    db.exec("COMMIT");
    return { deleted, inserted: parsed.cells.length };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export interface ManualMeta {
  file_name: string | null;
  date_from: string | null;
  date_to: string | null;
  cell_count: number | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
}

/** 표시 기간의 수기 일정과 실적(출하포장 PROD-10 — 칸에 적힌 수주번호의 양품수량을 실제 포장한 날짜 칸에 맞춘다) */
export function fetchManualSchedule(
  db: DatabaseSync,
  from: string,
  days: number
): { result: PackagingScheduleResult; meta: ManualMeta | null } {
  ensureManualScheduleTables(db);
  const to = addDays(from, days - 1);
  const cells = (
    db
      .prepare(
        `SELECT plan_date, line_key, product_name, plan_qty, pack_size, customer, due_date, so_no
           FROM packaging_manual_schedule WHERE plan_date BETWEEN ? AND ? ORDER BY plan_date, line_key`
      )
      .all(from, to) as unknown as Omit<PackagingCell, "pack_method">[]
  ).map((c) => ({ ...c, pack_method: null })) as PackagingCell[];

  // 수주번호 → 수기 일정에서 처음 계획한 라인 — 그 라인의 실적으로 본다
  const lineBySo = new Map<string, string>();
  for (const r of db
    .prepare("SELECT line_key, so_no FROM packaging_manual_schedule WHERE so_no IS NOT NULL ORDER BY plan_date, line_key")
    .all() as { line_key: string; so_no: string }[]) {
    for (const so of splitSoNos(r.so_no)) if (!lineBySo.has(so)) lineBySo.set(so, r.line_key);
  }
  const lineActuals: Record<string, PackagingDayActual> = {};
  for (const [so, lineKey] of lineBySo) {
    for (const r of p410BySo(db).get(so) ?? []) {
      if (r.d < from || r.d > to) continue;
      const a = (lineActuals[`${lineKey}|${r.d}`] ??= { total: 0, details: [] });
      a.total += r.q;
      a.details.push({ so, line: r.l, qty: r.q });
    }
  }
  const calRows = db
    .prepare("SELECT cal_date, day_type FROM production_calendar WHERE cal_date BETWEEN ? AND ? ORDER BY cal_date")
    .all(from, to) as { cal_date: string; day_type: string }[];
  const meta = (db.prepare("SELECT file_name, date_from, date_to, cell_count, uploaded_by, uploaded_at FROM packaging_manual_meta WHERE id = 1").get() ??
    null) as ManualMeta | null;
  return {
    result: {
      from,
      to,
      lines: PACKAGING_LINES,
      cells,
      lineActuals,
      soPriorActual: {},
      manualPlanLines: [],
      missingSoNos: [],
      holidays: calRows.filter((r) => r.day_type === "휴일").map((r) => r.cal_date),
      workDays: calRows.filter((r) => r.day_type === "평일").map((r) => r.cal_date),
    },
    meta,
  };
}
