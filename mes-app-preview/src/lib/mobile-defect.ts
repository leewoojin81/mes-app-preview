// 모바일 불량입력(/m/defect) — 공정이동표 QR(작업지시번호)을 휴대폰으로 찍어 불량을 입력한다.
// 2026-11-19 신설(사용자 요청). 기존 파일(db.ts·nav-groups·permissions 등)을 고치지 않고 이 파일과
// /m/defect, /api/m-defect/* 만 추가하는 방식 — 개발서버(3000)에 새 파일만 복사해 써 볼 수 있게.
//
// - 테이블 2개는 이 모듈이 처음 쓰일 때 CREATE TABLE IF NOT EXISTS로 만든다(DROP/ALTER 없음).
// - 작업지시 조회: work_order_status(PROD-05, ERP 업로드) → 없으면 process_wip_status(INV-03) → defect_type_status(PROD-07).
//   ERP 업로드 전인 지시는 조회되지 않는다(저장 불가, 화면에서 안내).
// - 사진: DB가 아니라 data/defect-photos/YYYY/MM/DD/<id>_<n>.jpg 에 저장하고 DB엔 상대경로만 넣는다
//   (DB 일일 백업 크기를 키우지 않기 위해). 브라우저가 긴 변 1600px JPG로 줄여 올린다.
import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const MD_PROCESSES = [
  "조립", "분리3", "습윤", "외관검사", "이재기", "실링", "멸균", "입고대기", "중간창고", "마킹", "출하포장",
] as const;

// 공정이동표에 인쇄된 불량유형 14종(공통) + 마킹 공정 전용 3종. 화면에서 바꿀 수 있게 마스터 테이블로 둔다.
const SEED_TYPES: [code: string, name: string, process: string | null, sort: number][] = [
  ["01", "깨짐", null, 1], ["02", "뜯김", null, 2], ["03", "이물1", null, 3], ["04", "이물2", null, 4],
  ["05", "색퍼짐", null, 5], ["06", "인쇄不", null, 6], ["07", "기스", null, 7], ["08", "성형不", null, 8],
  ["09", "얼룩", null, 9], ["10", "기포", null, 10], ["11", "색,지렁이", null, 11], ["12", "중심", null, 12],
  ["13", "기타", null, 13], ["14", "수량착오", null, 14],
  ["M01", "렌즈접힘", "마킹", 101], ["M02", "마킹불량", "마킹", 102], ["M03", "렌즈붙음", "마킹", 103],
];

const ensured = new WeakSet<DatabaseSync>();

export function ensureMobileDefectTables(db: DatabaseSync): void {
  if (ensured.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS defect_type_master (
      type_code TEXT PRIMARY KEY,
      type_name TEXT NOT NULL,
      process_name TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      use_yn TEXT NOT NULL DEFAULT 'Y',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS mobile_defect_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wo_no TEXT NOT NULL,
      lot_no TEXT,
      item_code TEXT,
      item_info TEXT,
      process_name TEXT NOT NULL,
      defect_type_code TEXT NOT NULL,
      defect_type_name TEXT NOT NULL,
      qty REAL NOT NULL,
      memo TEXT,
      photo1 TEXT,
      photo2 TEXT,
      photo3 TEXT,
      input_method TEXT NOT NULL,
      qr_raw TEXT,
      username TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mde_user_time ON mobile_defect_entries(username, created_at);
    CREATE INDEX IF NOT EXISTS idx_mde_wo ON mobile_defect_entries(wo_no);
  `);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM defect_type_master").get() as { n: number }).n;
  if (count === 0) {
    const ins = db.prepare(
      "INSERT OR IGNORE INTO defect_type_master (type_code, type_name, process_name, sort_order) VALUES (?, ?, ?, ?)"
    );
    for (const [c, n, p, s] of SEED_TYPES) ins.run(c, n, p, s);
  }
  ensured.add(db);
}

export type DefectType = { type_code: string; type_name: string; process_name: string | null };

// 공통 유형 + 그 공정 전용 유형. 공정 전용을 앞에 둔다(그 공정에서 자주 쓰므로).
export function listDefectTypes(db: DatabaseSync, processName: string | null): DefectType[] {
  ensureMobileDefectTables(db);
  return db
    .prepare(
      `SELECT type_code, type_name, process_name FROM defect_type_master
       WHERE use_yn = 'Y' AND (process_name IS NULL OR process_name = ?)
       ORDER BY CASE WHEN process_name IS NULL THEN 1 ELSE 0 END, sort_order, type_code`
    )
    .all(processName ?? "") as DefectType[];
}

/** QR 판독값/직접 입력값에서 작업지시번호(PR + 숫자 12자리)를 꺼낸다 */
export function extractWoNo(raw: string): string | null {
  const m = String(raw || "").toUpperCase().match(/PR\d{12}/);
  return m ? m[0] : null;
}

export type WoLookup = {
  wo_no: string;
  item_code: string | null;
  item_info: string | null;
  lot_no: string | null;
  order_qty: number | null;
  so_no: string | null;
  status: string | null;
  source: string;
};

function pick(d: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = d[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}
function num(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function lookupWorkOrder(db: DatabaseSync, woNo: string): WoLookup | null {
  const tries: [table: string, label: string][] = [
    ["work_order_status", "작업지시현황(PROD-05)"],
    ["process_wip_status", "공정재공현황(INV-03)"],
    ["defect_type_status", "불량종합현황(PROD-07)"],
  ];
  for (const [table, label] of tries) {
    let row: { item_code: string | null; lot_no: string | null; so_no?: string | null; detail: string | null } | undefined;
    try {
      row = db
        .prepare(`SELECT * FROM ${table} WHERE wo_no = ? ORDER BY id DESC LIMIT 1`)
        .get(woNo) as typeof row;
    } catch {
      row = undefined; // 테이블이 없는 DB(새로 만든 개발 DB 등)
    }
    if (!row) continue;
    let d: Record<string, unknown> = {};
    try {
      d = row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : {};
    } catch {
      d = {};
    }
    return {
      wo_no: woNo,
      item_code: row.item_code ?? pick(d, "품목코드"),
      item_info: pick(d, "품목정보", "품목명", "품명"),
      lot_no: row.lot_no ?? pick(d, "LOT-NO", "LOT No", "LOT NO"),
      order_qty: num(pick(d, "지시수량")),
      so_no: row.so_no ?? pick(d, "수주번호"),
      status: pick(d, "상태"),
      source: label,
    };
  }
  return null;
}

// ── 사진 저장 ────────────────────────────────────────────────────────────────
export const PHOTO_ROOT = path.join(process.cwd(), "data", "defect-photos");
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // 브라우저가 1600px로 줄이므로 보통 150~400KB

export function isJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/** 사진을 저장하고 PHOTO_ROOT 기준 상대경로(YYYY/MM/DD/<id>_<n>.jpg)를 돌려준다 */
export function savePhoto(entryId: number, n: number, buf: Buffer, ymd: string): string {
  const [y, m, d] = ymd.split("-");
  const rel = path.posix.join(y, m, d, `${entryId}_${n}.jpg`);
  const abs = path.join(PHOTO_ROOT, y, m, d);
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(path.join(abs, `${entryId}_${n}.jpg`), buf);
  return rel;
}

/** 상대경로 → 절대경로. PHOTO_ROOT 밖을 가리키면 null */
export function photoAbsPath(rel: string): string | null {
  if (!/^\d{4}\/\d{2}\/\d{2}\/\d+_[1-3]\.jpg$/.test(rel)) return null;
  const abs = path.join(PHOTO_ROOT, ...rel.split("/"));
  return abs.startsWith(PHOTO_ROOT + path.sep) ? abs : null;
}

export type EntryRow = {
  id: number;
  wo_no: string;
  lot_no: string | null;
  item_info: string | null;
  process_name: string;
  defect_type_name: string;
  qty: number;
  memo: string | null;
  photo1: string | null;
  photo2: string | null;
  photo3: string | null;
  input_method: string;
  created_at: string;
};
