import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

// 공정 불량이력관리 — 일일작업현황(daily_work_status) 실적 한 줄(record_key)에 불량 내용·사진·동영상을 붙인다.
// 처음은 마킹(PROC-06-02, P400) 탭(2026-11-17). record_key(작지|공정코드|LOT|공정순서|등록시각)는 엑셀을 다시 올려도
// 그대로라, 기록이 재업로드에 안 지워진다. record_key에 공정코드가 들어 있어 다른 공정도 같은 표를 쓸 수 있다.
// 사진·동영상 파일은 DB가 아닌 data/defect-media/에 둔다(동영상이 커서 DB·일일 백업이 무거워지지 않게).

export const MEDIA_DIR = path.join(process.cwd(), "data", "defect-media");
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 190 * 1024 * 1024; // proxy 본문 한도 200mb 안쪽

export type DefectRow = {
  key: string;
  date: string;
  shift: string;
  line: string;
  worker: string;
  item: string;
  itemName: string;
  model: string;
  wo: string;
  lot: string;
  so: string;
  good: number;
  bad: number;
  regAt: string;
  content: string;
  updatedBy: string | null;
  updatedAt: string | null;
  photos: number;
  videos: number;
};

export type DefectMedia = {
  id: number;
  kind: "photo" | "video";
  name: string;
  mime: string;
  size: number;
  createdBy: string | null;
  createdAt: string;
};

let ensured = false;
export function ensureDefectHistoryTables(db: DatabaseSync) {
  if (ensured) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS defect_history_notes (
      record_key TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS defect_history_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_name TEXT NOT NULL,
      orig_name TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_defect_history_media_key ON defect_history_media(record_key);
  `);
  ensured = true;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 공정 실적 목록 — onlyBad면 불량수량 > 0 이거나 기록(내용·사진·동영상)이 있는 줄만 */
export function listDefectRows(
  db: DatabaseSync,
  opt: { processCode: string; from: string; to: string; onlyBad: boolean }
): { rows: DefectRow[]; truncated: boolean } {
  ensureDefectHistoryTables(db);
  const LIMIT = 5000;
  const raw = db
    .prepare(
      `SELECT d.record_key k, d.work_date dt, d.item_code item, d.wo_no wo, d.lot_no lot,
              json_extract(d.detail, '$."구분"') shift, json_extract(d.detail, '$."라인"') line,
              json_extract(d.detail, '$."작업자"') worker, json_extract(d.detail, '$."품목정보"') item_name,
              json_extract(d.detail, '$."형명"') model, json_extract(d.detail, '$."수주번호"') so,
              json_extract(d.detail, '$."양품수량"') good, json_extract(d.detail, '$."불량수량"') bad,
              json_extract(d.detail, '$."등록시각"') reg_at,
              n.content, n.updated_by, n.updated_at,
              (SELECT COUNT(*) FROM defect_history_media m WHERE m.record_key = d.record_key AND m.kind = 'photo') photos,
              (SELECT COUNT(*) FROM defect_history_media m WHERE m.record_key = d.record_key AND m.kind = 'video') videos
         FROM daily_work_status d
         LEFT JOIN defect_history_notes n ON n.record_key = d.record_key
        WHERE d.process_code = ? AND d.work_date BETWEEN ? AND ?
          AND (? = 0 OR CAST(json_extract(d.detail, '$."불량수량"') AS REAL) > 0
               OR COALESCE(n.content, '') <> ''
               OR EXISTS (SELECT 1 FROM defect_history_media m WHERE m.record_key = d.record_key))
        ORDER BY d.work_date DESC, reg_at DESC
        LIMIT ${LIMIT + 1}`
    )
    .all(opt.processCode, opt.from, opt.to, opt.onlyBad ? 1 : 0) as Record<string, unknown>[];
  const s = (v: unknown) => (v == null ? "" : String(v).trim());
  const rows = raw.slice(0, LIMIT).map((r) => ({
    key: s(r.k),
    date: s(r.dt),
    shift: s(r.shift),
    line: s(r.line),
    worker: s(r.worker),
    item: s(r.item),
    itemName: s(r.item_name),
    model: s(r.model),
    wo: s(r.wo),
    lot: s(r.lot),
    so: s(r.so),
    good: num(r.good),
    bad: num(r.bad),
    regAt: s(r.reg_at),
    content: s(r.content),
    updatedBy: (r.updated_by as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
    photos: num(r.photos),
    videos: num(r.videos),
  }));
  return { rows, truncated: raw.length > LIMIT };
}

export function workRowExists(db: DatabaseSync, key: string, processCode: string): boolean {
  return !!db.prepare("SELECT 1 FROM daily_work_status WHERE record_key = ? AND process_code = ?").get(key, processCode);
}

export function saveNote(db: DatabaseSync, key: string, content: string, user: string | null) {
  ensureDefectHistoryTables(db);
  if (!content.trim()) {
    db.prepare("DELETE FROM defect_history_notes WHERE record_key = ?").run(key);
    return;
  }
  db.prepare(
    `INSERT INTO defect_history_notes (record_key, content, updated_by, updated_at)
     VALUES (?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(record_key) DO UPDATE SET content = excluded.content, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(key, content, user);
}

export function listMedia(db: DatabaseSync, key: string): DefectMedia[] {
  ensureDefectHistoryTables(db);
  return (
    db
      .prepare("SELECT id, kind, orig_name, mime, size, created_by, created_at FROM defect_history_media WHERE record_key = ? ORDER BY id")
      .all(key) as { id: number; kind: "photo" | "video"; orig_name: string; mime: string; size: number; created_by: string | null; created_at: string }[]
  ).map((m) => ({ id: m.id, kind: m.kind, name: m.orig_name, mime: m.mime, size: m.size, createdBy: m.created_by, createdAt: m.created_at }));
}

export function getMedia(db: DatabaseSync, id: number) {
  ensureDefectHistoryTables(db);
  return db.prepare("SELECT id, record_key, kind, file_name, orig_name, mime, size FROM defect_history_media WHERE id = ?").get(id) as
    | { id: number; record_key: string; kind: string; file_name: string; orig_name: string; mime: string; size: number }
    | undefined;
}

export function mediaPath(fileName: string) {
  return path.join(MEDIA_DIR, path.basename(fileName));
}

export function ensureMediaDir() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}
