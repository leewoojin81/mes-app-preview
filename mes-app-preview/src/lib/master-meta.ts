import type { DatabaseSync } from "node:sqlite";

// 기준정보(BASE-01~09) 화면의 "최근 업로드 / 수정일자" 표기용.
// - 행별 수정일자: 각 테이블의 updated_at 컬럼을 DB 트리거가 관리한다(INSERT/UPDATE 시 자동 기록).
//   엑셀 업로드의 ON CONFLICT DO UPDATE도 UPDATE라 함께 찍힌다.
// - 화면별 최근 업로드 시각: master_upload_log에 업로드 API가 기록한다.

export const MASTER_TRIGGER_TABLES = [
  "items",
  "bom",
  "processes",
  "equipments",
  "customers",
  "warehouses",
  "workers",
] as const;

export function migrateMasterTimestamps(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS master_upload_log (
      screen_key TEXT PRIMARY KEY,
      uploaded_at TEXT NOT NULL
    );
  `);
  for (const t of MASTER_TRIGGER_TABLES) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "updated_at")) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN updated_at TEXT`);
    }
    // recursive_triggers는 기본 OFF라 트리거 안의 UPDATE가 자기 자신을 다시 부르지 않는다.
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_${t}_updated_at_ins
      AFTER INSERT ON ${t} WHEN NEW.updated_at IS NULL
      BEGIN
        UPDATE ${t} SET updated_at = datetime('now','localtime') WHERE rowid = NEW.rowid;
      END;
      CREATE TRIGGER IF NOT EXISTS trg_${t}_updated_at_upd
      AFTER UPDATE ON ${t} WHEN NEW.updated_at IS OLD.updated_at
      BEGIN
        UPDATE ${t} SET updated_at = datetime('now','localtime') WHERE rowid = NEW.rowid;
      END;
    `);
  }
}

export function recordUpload(db: DatabaseSync, screenKey: string) {
  // 업로드 시각 기록은 부가 정보다 — 실패해도(예: 마이그레이션 전) 이미 끝난 업로드를 실패로 만들지 않는다.
  try {
  db.prepare(
    `INSERT INTO master_upload_log (screen_key, uploaded_at) VALUES (?, datetime('now','localtime'))
     ON CONFLICT(screen_key) DO UPDATE SET uploaded_at = excluded.uploaded_at`
  ).run(screenKey);
  } catch (e) {
    console.error("[master-meta] 업로드 시각 기록 실패", e);
  }
}
