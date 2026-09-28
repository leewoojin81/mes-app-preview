import type { DatabaseSync } from "node:sqlite";

// 기준정보 공정정보(BASE-04) "공정별 목표 UPH" — 경영정보 공정별생산현황(MGMT-05) 추이
// 그래프의 목표선에 쓰는 고정 목표값. 보통 1년에 한 번만 바뀌는 값이라 매월 생산계획을
// 입력하는 계획정보(PLAN-02)가 아니라 기준정보에 (적용연도, 라인) 단위로 저장한다
// (2026-09-28 사용자 확인). 라인은 MGMT-05의 9개 라인(사출 상/하몰드가 같은 공정코드 P100을
// 공유하므로 공정코드가 아니라 라인 key 기준) — src/lib/production-status.ts 참고.
//
// 해당 연도에 값이 없으면 직전 연도 값을 그대로 이어받는다(getProcessUphTarget) — 매년 새로
// 입력하지 않아도 되고, 목표를 바꿀 때만 그 연도 행을 추가하면 지난 연도의 목표는 그대로 남는다.

/** db.ts의 SCHEMA_SQL은 프로세스에서 getDb()가 처음 연결을 만들 때 한 번만 실행되므로,
 *  이미 떠 있는 서버도 재시작 없이 동작하도록 매 호출에서 한 번 더 보장한다. */
export function ensureProcessUphTargetTable(db: DatabaseSync): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS process_uph_target (
      target_year INTEGER NOT NULL,
      line_key TEXT NOT NULL,
      target_uph REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_by TEXT,
      PRIMARY KEY (target_year, line_key)
    )`
  );
}

export interface ProcessUphTarget {
  /** 실제 적용되는 목표 UPH (그 연도 값, 없으면 직전 연도 값) */
  targetUph: number;
  /** 값이 저장돼 있는 연도 — 조회 연도와 다르면 그 연도 값을 이어받아 쓰는 중 */
  fromYear: number;
}

export function getProcessUphTarget(
  db: DatabaseSync,
  lineKey: string,
  year: number
): ProcessUphTarget | null {
  ensureProcessUphTargetTable(db);
  const row = db
    .prepare(
      `SELECT target_year, target_uph FROM process_uph_target
       WHERE line_key = ? AND target_year <= ? AND target_uph IS NOT NULL
       ORDER BY target_year DESC LIMIT 1`
    )
    .get(lineKey, year) as { target_year: number; target_uph: number } | undefined;
  return row ? { targetUph: row.target_uph, fromYear: row.target_year } : null;
}
