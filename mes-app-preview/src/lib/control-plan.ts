import type { DatabaseSync } from "node:sqlite";

// 품질관리 "Control Plan(QC-00)" — 공정품질이 관리하는 Control Plan(관리계획서) PDF를 개정판별로 올려 두고 화면에서 바로 본다
// (2026-10-26 사용자 요청, 첫 자료 "(사출제외) Control Plan_Rev.09_260930.pdf"). 파일 본문은 QC-03 부자재 사진처럼 DB BLOB에 둔다
// (DB 일일 백업에 같이 들어간다). 같은 문서의 개정판이 계속 쌓이므로 삭제 대신 새 개정을 올리는 것이 기본이다.

export interface ControlPlanFile {
  id: number;
  title: string;
  rev_no: string;
  rev_date: string | null;
  note: string;
  file_name: string;
  size: number;
  uploaded_at: string;
  uploaded_by: string | null;
}

export const CONTROL_PLAN_MAX_BYTES = 50 * 1024 * 1024;

export function ensureControlPlanTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS qc_control_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      rev_no TEXT NOT NULL DEFAULT '',
      rev_date TEXT,
      note TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT 'application/pdf',
      size INTEGER NOT NULL DEFAULT 0,
      data BLOB NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      uploaded_by TEXT
    );
  `);
}

/** 문서명 → 개정일자(최신) → 올린 순서로. 본문(data)은 빼고 목록만 */
export function listControlPlans(db: DatabaseSync): ControlPlanFile[] {
  ensureControlPlanTables(db);
  return db
    .prepare(
      `SELECT id, title, rev_no, rev_date, note, file_name, size, uploaded_at, uploaded_by
         FROM qc_control_plans
        ORDER BY title, COALESCE(rev_date, '') DESC, rev_no DESC, id DESC`
    )
    .all() as unknown as ControlPlanFile[];
}

/**
 * 파일명에서 문서명·개정번호·개정일자를 뽑는다(올리기 창 기본값).
 * 예: "(사출제외) Control Plan_Rev.09_260930.pdf" → 문서명 "(사출제외) Control Plan", 개정 "09", 일자 "2026-09-30"
 */
export function parseControlPlanFileName(fileName: string): { title: string; rev_no: string; rev_date: string } {
  const base = fileName.replace(/\.pdf$/i, "").trim();
  const rev = /[_\s-]*Rev\.?\s*(\d+)/i.exec(base);
  const date = /(?:^|[_\s-])(\d{2}|\d{4})(\d{2})(\d{2})(?=$|[_\s-])/.exec(base);
  let title = base;
  if (rev) title = title.slice(0, rev.index);
  else if (date) title = title.slice(0, date.index);
  let revDate = "";
  if (date) {
    const y = date[1].length === 2 ? `20${date[1]}` : date[1];
    const m = Number(date[2]);
    const d = Number(date[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) revDate = `${y}-${date[2]}-${date[3]}`;
  }
  return { title: title.replace(/[_\s-]+$/, "").trim() || base, rev_no: rev ? rev[1] : "", rev_date: revDate };
}
