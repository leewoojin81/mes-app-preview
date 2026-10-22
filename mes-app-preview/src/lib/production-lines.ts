import type { DatabaseSync } from "node:sqlite";
import { ensureMasterHistoryTriggers } from "@/lib/master-history-triggers";

// 생산 라인(2026-10-22, 기준정보 공정정보 BASE-04에서 관리) — 공정 여러 개를 회사에서 부르는 단위로 묶은 것.
// 예전에는 계획정보(PLAN-02, production-plan-lines.ts)와 공정별생산현황(MGMT-05, production-status.ts)이
// 라인 목록·이름·공정을 코드에 따로 적어 두었다. 이제 라인 자체(production_lines)와 공정의 소속 라인
// (processes.line_key)을 DB에 두고 두 화면이 여기서 읽는다. line_key는 line_capa_plan·process_uph_target에
// 저장된 키라 한 번 만들면 바꾸지 않는다.
// ERP 리포트를 읽는 방식(사출=MOLD입고 상/하몰드, 공정재공 열 이름 예외, 착색 재공=조립창고 재고)은
// 화면에서 바꿀 값이 아니라 production-status.ts에 line_key별로 그대로 둔다.

export interface ProductionLine {
  line_key: string;
  line_name: string;
  /** 공정별생산현황(MGMT-05)·목표 UPH에 보이는 이름 — 비어 있으면 line_name */
  status_name: string | null;
  /** 공정별생산현황 실적·인원·근무시간을 셀 대표 공정 1개 */
  result_process_code: string | null;
  /** 간접직 — CAPA 없이 인원만 집계하고 공정별생산현황에는 나오지 않는다 */
  is_indirect: "Y" | "N";
  seq: number;
  use_yn: "Y" | "N";
  remark: string | null;
  updated_at: string | null;
  /** 이 라인에 속한 공정(processes.line_key, 공정 순서대로) */
  processCodes: string[];
}

// 처음 만들 때 넣는 값 — 2026-10-22까지 코드에 적혀 있던 PLAN-02 라인 10개(이름·공정)와
// MGMT-05 표시명·실적 공정을 그대로 옮겼다. 사출_하는 대응 공정이 없어(P100은 사출_상 소속)
// 소속 공정 없이 두고, 실적 공정만 사출_상과 같은 P100(인원·근무시간 기준)으로 둔다.
const SEED: Omit<ProductionLine, "seq" | "use_yn" | "remark" | "updated_at">[] = [
  { line_key: "injection_upper", line_name: "사출_상", status_name: "사출상몰드", result_process_code: "P100", is_indirect: "N", processCodes: ["P100"] },
  { line_key: "injection_lower", line_name: "사출_하", status_name: "사출하몰드", result_process_code: "P100", is_indirect: "N", processCodes: [] },
  { line_key: "coloring", line_name: "착색", status_name: "착색인쇄", result_process_code: "P220", is_indirect: "N", processCodes: ["P150", "P200", "P210", "P220", "P230", "P240"] },
  { line_key: "assembly", line_name: "조립", status_name: null, result_process_code: "P300", is_indirect: "N", processCodes: ["P300", "P310"] },
  { line_key: "separation", line_name: "분리", status_name: "분리3", result_process_code: "P340", is_indirect: "N", processCodes: ["P320", "P330", "P340", "P350", "P355"] },
  { line_key: "appearance", line_name: "외관", status_name: "외관검사", result_process_code: "P360", is_indirect: "N", processCodes: ["P356", "P360", "P361"] },
  { line_key: "sealing", line_name: "실링", status_name: null, result_process_code: "P370", is_indirect: "N", processCodes: ["P370", "P380"] },
  { line_key: "marking", line_name: "마킹", status_name: null, result_process_code: "P400", is_indirect: "N", processCodes: ["P385", "P390", "P400"] },
  { line_key: "shipping", line_name: "출하", status_name: "출하포장", result_process_code: "P410", is_indirect: "N", processCodes: ["P410"] },
  { line_key: "indirect", line_name: "간접직", status_name: null, result_process_code: null, is_indirect: "Y", processCodes: ["P500", "P501", "P502", "P503", "P504", "P505", "P510"] },
];

/** db.ts의 SCHEMA_SQL·migrate는 프로세스에서 getDb()가 처음 연결할 때 한 번만 돌아, 이미 떠 있는
 *  서버도 재시작 없이 동작하도록 라인을 읽을 때마다 한 번 더 보장한다(테이블이 이미 있으면 PRAGMA 한 번). */
export function ensureProductionLines(db: DatabaseSync, opts: { triggers?: boolean } = {}): void {
  const procCols = db.prepare("PRAGMA table_info(processes)").all() as { name: string }[];
  if (procCols.length > 0 && !procCols.some((c) => c.name === "line_key")) {
    db.exec("ALTER TABLE processes ADD COLUMN line_key TEXT");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS production_lines (
    line_key TEXT PRIMARY KEY,
    line_name TEXT NOT NULL,
    status_name TEXT,
    result_process_code TEXT,
    is_indirect TEXT NOT NULL DEFAULT 'N',
    seq INTEGER NOT NULL DEFAULT 0,
    use_yn TEXT NOT NULL DEFAULT 'Y',
    remark TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  const n = (db.prepare("SELECT COUNT(*) c FROM production_lines").get() as { c: number }).c;
  if (n === 0) {
    const ins = db.prepare(
      `INSERT INTO production_lines (line_key, line_name, status_name, result_process_code, is_indirect, seq) VALUES (?, ?, ?, ?, ?, ?)`
    );
    const setLine = db.prepare("UPDATE processes SET line_key = ? WHERE process_code = ? AND line_key IS NULL");
    db.exec("BEGIN");
    try {
      SEED.forEach((l, i) => {
        ins.run(l.line_key, l.line_name, l.status_name, l.result_process_code, l.is_indirect, (i + 1) * 10);
        for (const code of l.processCodes) setLine.run(l.line_key, code);
      });
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  // 라인 테이블·공정의 라인 열 변경이력 트리거(버전이 같으면 바로 끝난다). db.ts migrate 안에서는 끄고
  // 다른 컬럼 추가가 다 끝난 뒤 getDb()가 부르는 것을 쓴다(중간에 만들면 뒤에 추가되는 컬럼 트리거가 빠진다).
  if (opts.triggers !== false) ensureMasterHistoryTriggers(db);
}

/** 전체 라인(사용 중단 포함, 순서대로) — 화면별로 use_yn/is_indirect를 걸러 쓴다 */
export function getProductionLines(db: DatabaseSync): ProductionLine[] {
  ensureProductionLines(db);
  const lines = db
    .prepare("SELECT line_key, line_name, status_name, result_process_code, is_indirect, seq, use_yn, remark, updated_at FROM production_lines ORDER BY seq, line_key")
    .all() as unknown as Omit<ProductionLine, "processCodes">[];
  const procs = db
    .prepare("SELECT process_code, line_key FROM processes WHERE line_key IS NOT NULL ORDER BY seq, process_code")
    .all() as { process_code: string; line_key: string }[];
  return lines.map((l) => ({ ...l, processCodes: procs.filter((p) => p.line_key === l.line_key).map((p) => p.process_code) }));
}

/** 사용 중인 라인만 */
export function getActiveProductionLines(db: DatabaseSync): ProductionLine[] {
  return getProductionLines(db).filter((l) => l.use_yn === "Y");
}
