import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { addDays, ensurePackagingScheduleTable, PACKAGING_LINES, splitSoNos } from "@/lib/packaging-schedule";

// 계획정보(PLAN-03) "라인별" 탭 — 블록(라인×일자 한 칸 전체) 드래그&드롭 이동(1단계).
// 기본 동작은 "삽입 후 밀기": 놓은 칸에 블록을 넣고, 원래 그 칸과 뒤 근무일의 블록을 한 칸씩 뒤 근무일로 민다.
// 쉬는 날(화면의 빨간 칸)은 건너뛰고, 빈 근무일 칸(원래 블록이 빠져나간 칸 포함)을 만나면 멈춘다.
// 한 칸은 packaging_schedule 한 행(수주번호가 여러 개면 한 행에 같이 적힘)과 packaging_cell_so_plan 행들이라 묶음째 옮겨진다.
// 실적은 일일작업현황에서 날짜별로 읽으므로 옮기지 않는다. 오늘 이전 칸은 옮기지도, 놓지도 못한다.

export function ensurePackagingMoveHistoryTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS packaging_move_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      moved_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      moved_by TEXT,
      line_key TEXT NOT NULL,
      so_no TEXT NOT NULL,
      from_date TEXT NOT NULL,
      to_date TEXT NOT NULL,
      mode TEXT NOT NULL,
      is_dragged INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_packaging_move_history_batch ON packaging_move_history(batch_id)");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 화면의 빨간 칸 규칙(page.tsx dayKind)과 같다 — 토요일은 항상 쉬고, 일요일은 캘린더에서 '평일'일 때만 일하며, 평일이라도 캘린더 '휴일'이면 쉰다 */
function makeIsOff(db: DatabaseSync, fromDate: string): (d: string) => boolean {
  const rows = db.prepare("SELECT cal_date, day_type FROM production_calendar WHERE cal_date >= ?").all(fromDate) as { cal_date: string; day_type: string }[];
  const holidays = new Set(rows.filter((r) => r.day_type === "휴일").map((r) => r.cal_date));
  const workDays = new Set(rows.filter((r) => r.day_type === "평일").map((r) => r.cal_date));
  return (d) => {
    const [y, m, dd] = d.split("-").map(Number);
    const wd = new Date(y, m - 1, dd).getDay();
    if (wd === 0) return !workDays.has(d);
    if (wd === 6) return true;
    return holidays.has(d);
  };
}

interface CellRow {
  plan_date: string;
  line_key: string;
  product_name: string | null;
  plan_qty: number | null;
  pack_size: string | null;
  customer: string | null;
  due_date: string | null;
  so_no: string | null;
}
interface SoPlanRow {
  plan_date: string;
  line_key: string;
  so_no: string;
  plan_qty: number;
}

export interface MoveResult {
  moved: { so_no: string; from: string; to: string; dragged: boolean }[];
}

export class MoveError extends Error {}

export function movePackagingBlock(
  db: DatabaseSync,
  p: { lineKey: string; fromDate: string; toDate: string; mode: string; user: string | null }
): MoveResult {
  const { lineKey, fromDate, toDate, mode, user } = p;
  if (!PACKAGING_LINES.some((l) => l.key === lineKey)) throw new MoveError("올바른 라인이 아닙니다.");
  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) throw new MoveError("날짜 형식이 올바르지 않습니다.");
  if (mode !== "push") throw new MoveError("지원하지 않는 이동 방식입니다.");
  if (fromDate === toDate) throw new MoveError("같은 칸입니다.");
  const today = localToday();
  if (fromDate < today || toDate < today) throw new MoveError("오늘 이전 칸은 옮기거나 놓을 수 없습니다.");

  ensurePackagingScheduleTable(db);
  ensurePackagingMoveHistoryTable(db);
  const isOff = makeIsOff(db, today);
  if (isOff(toDate)) throw new MoveError("쉬는 날에는 놓을 수 없습니다.");

  const lo = fromDate < toDate ? fromDate : toDate;
  const cells = db
    .prepare(
      `SELECT plan_date, line_key, product_name, plan_qty, pack_size, customer, due_date, so_no
         FROM packaging_schedule
        WHERE line_key = ? AND plan_date >= ? AND so_no IS NOT NULL AND TRIM(so_no) <> ''`
    )
    .all(lineKey, lo) as unknown as CellRow[];
  const byDate = new Map(cells.map((c) => [c.plan_date, c]));
  const source = byDate.get(fromDate);
  if (!source) throw new MoveError("옮길 블록이 없습니다.");

  const soPlans = db.prepare("SELECT plan_date, line_key, so_no, plan_qty FROM packaging_cell_so_plan WHERE line_key = ? AND plan_date >= ?").all(lineKey, lo) as unknown as SoPlanRow[];

  // 이동 계획 — 원래 칸에서 블록을 빼고 놓은 칸부터 뒤 근무일로 밀며, 빈 칸을 만나면 멈춘다
  byDate.delete(fromDate);
  const moves: { cell: CellRow; to: string; dragged: boolean }[] = [];
  let carry: CellRow = source;
  let carryDragged = true;
  let cur = toDate;
  for (let i = 0; ; i++) {
    if (i > 400) throw new MoveError("밀어낼 칸이 너무 많아 이동할 수 없습니다.");
    const here = byDate.get(cur);
    moves.push({ cell: carry, to: cur, dragged: carryDragged });
    if (!here) break;
    carry = here;
    carryDragged = false;
    do {
      cur = addDays(cur, 1);
    } while (isOff(cur));
  }

  const batchId = randomUUID();
  const involved = new Set([fromDate, ...moves.map((m) => m.cell.plan_date), ...moves.map((m) => m.to)]);
  db.exec("BEGIN");
  try {
    const del = db.prepare("DELETE FROM packaging_schedule WHERE plan_date = ? AND line_key = ?");
    const delPlan = db.prepare("DELETE FROM packaging_cell_so_plan WHERE plan_date = ? AND line_key = ?");
    for (const d of involved) {
      del.run(d, lineKey);
      delPlan.run(d, lineKey);
    }
    const ins = db.prepare(
      `INSERT INTO packaging_schedule (plan_date, line_key, product_name, plan_qty, pack_size, customer, due_date, so_no, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?)`
    );
    const insPlan = db.prepare("INSERT INTO packaging_cell_so_plan (plan_date, line_key, so_no, plan_qty) VALUES (?, ?, ?, ?)");
    const hist = db.prepare(
      "INSERT INTO packaging_move_history (batch_id, moved_by, line_key, so_no, from_date, to_date, mode, is_dragged) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const moved: MoveResult["moved"] = [];
    for (const m of moves) {
      const c = m.cell;
      ins.run(m.to, lineKey, c.product_name, c.plan_qty, c.pack_size, c.customer, c.due_date, c.so_no, user);
      for (const sp of soPlans.filter((s) => s.plan_date === c.plan_date)) insPlan.run(m.to, lineKey, sp.so_no, sp.plan_qty);
      if (m.to === c.plan_date) continue;
      for (const so of splitSoNos(c.so_no)) {
        hist.run(batchId, user, lineKey, so, c.plan_date, m.to, mode, m.dragged ? 1 : 0);
        moved.push({ so_no: so, from: c.plan_date, to: m.to, dragged: m.dragged });
      }
    }
    db.exec("COMMIT");
    return { moved };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
