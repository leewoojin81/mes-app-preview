import type { DatabaseSync } from "node:sqlite";
import { ENTITY_TYPE_WORKER, WORKER_TRACKED_FIELDS } from "@/lib/master-data-history";

// ── 기준정보(BASE-01~09) 변경이력 자동 기록 — DB 트리거 ─────────────────────────────────────
// 2026-10-21 사용자 요청: "BASE-01~BASE-09까지 변경이 되면 이력을 모두 남겨줘". 화면·API·엑셀 업로드·스크립트 어디서
// 바꾸든 빠짐없이 남도록, 각 기준정보 테이블에 등록/삭제/컬럼별 수정 트리거를 걸어 master_data_change_history에 쌓는다
// (값이 실제로 바뀐 컬럼만). 변경자는 API가 쓰기 직전에 master_history_ctx에 적어 둔 로그인 계정(setHistoryActor)이고,
// 적어 둔 시간(기본 20초)이 지났거나 API를 거치지 않은 변경(스크립트·마이그레이션)은 변경자를 비워 둔다.
// 작업자(workers)의 WORKER_TRACKED_FIELDS 컬럼은 기존 API가 change_date까지 직접 기록하므로 그 API들은 skipTracked로
// 트리거의 중복 기록을 끈다(엑셀 업로드 등 직접 기록하지 않는 경로는 트리거가 남긴다).
// 등록/삭제는 field가 '__insert'/'__delete'인 한 행(대상명을 새값/기존값에 적음)으로 남는다.

// 2: 생산 라인(production_lines)·공정의 라인(processes.line_key) 추가(2026-10-22)
// 3: 공통정보(BASE-10) 형명(model_names)·형명 원료로트(model_name_lots) 추가(2026-10-23)
const HISTORY_TRIGGER_VERSION = 3;
const NOW_SEC = "CAST(strftime('%s','now') AS INTEGER)";
const ACTOR_SQL = `(SELECT CASE WHEN until_sec >= ${NOW_SEC} THEN actor END FROM master_history_ctx WHERE id = 1)`;
const SKIP_TRACKED_SQL = `COALESCE((SELECT CASE WHEN until_sec >= ${NOW_SEC} THEN skip_tracked END FROM master_history_ctx WHERE id = 1), 0)`;

interface HistoryTableDef {
  table: string;
  /** 대상ID 식 — r은 NEW/OLD */
  id: (r: string) => string;
  /** 대상유형 식 */
  type: (r: string) => string;
  /** 등록/삭제 행에 남길 요약(대상명) 식 */
  summary: (r: string) => string;
  labels: Record<string, string>;
  /** 이력을 남기지 않을 컬럼 */
  skip?: string[];
  /** JSON 컬럼 — 키별로 비교해 바뀐 키만 남긴다 */
  jsonCols?: string[];
  /** 작업자: 기존 API가 직접 기록하는 컬럼 */
  trackedCols?: string[];
}

// 정렬순서·갱신시각은 의미 있는 변경이 아니라 이력에서 뺀다
const COMMON_SKIP = ["updated_at", "created_at", "seq", "seq_no"];
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

const HISTORY_TABLES: HistoryTableDef[] = [
  {
    table: "items",
    id: (r) => `${r}.item_code`,
    type: (r) => `CASE WHEN ${r}.category = '원자재' THEN '자재' ELSE '품목' END`,
    summary: (r) => `${r}.item_name`,
    labels: { item_name: "품목명", category: "구분", spec: "규격", unit: "단위", warehouse: "창고", safety_stock: "안전재고", use_yn: "사용여부" },
    jsonCols: ["detail"],
  },
  {
    table: "bom",
    id: (r) => `${r}.parent_item_code || '>' || ${r}.child_item_code`,
    type: () => lit("BOM"),
    summary: (r) => `'소요량 ' || ${r}.qty_per`,
    labels: { qty_per: "소요량", unit: "단위" },
  },
  {
    table: "processes",
    id: (r) => `${r}.process_code`,
    type: () => lit("공정"),
    summary: (r) => `${r}.process_name`,
    labels: {
      process_name: "공정명", procure_type: "조달구분", productivity_type: "생산성구분", process_group: "공정그룹", process_group2: "공정그룹2",
      single_process: "단일공정", use_yn: "사용여부", reg_date: "등록일", reg_by: "등록자", default_daily_capa: "기본 일CAPA",
      default_yield_rate: "기본 수율", default_lot_size: "기본 LOT", shift1_active_yn: "1교대 사용", shift1_start: "1교대 시작", shift1_end: "1교대 종료",
      shift1_base_minutes: "1교대 기준분", shift2_active_yn: "2교대 사용", shift2_start: "2교대 시작", shift2_end: "2교대 종료",
      shift2_base_minutes: "2교대 기준분", apply_work_pattern_yn: "근무패턴 적용", line_key: "라인",
    },
  },
  {
    table: "production_lines",
    id: (r) => `${r}.line_key`,
    type: () => lit("라인"),
    summary: (r) => `${r}.line_name`,
    labels: {
      line_name: "라인명", status_name: "현황 표시명", result_process_code: "실적 공정", is_indirect: "간접직", use_yn: "사용여부", remark: "비고",
    },
  },
  {
    table: "equipments",
    id: (r) => `${r}.equipment_id`,
    type: () => lit("설비"),
    summary: (r) => `${r}.equipment_name`,
    labels: {
      equipment_name: "설비명", workplace: "사업장", equipment_group: "설비그룹", personnel: "인원", wage_rate: "임율", ton: "톤수", line_id: "라인",
      bf_warehouse: "BF창고", defect_warehouse: "불량창고", defect_pattern: "불량패턴", daily_work_minutes: "일 작업분", work_time_type: "작업시간구분",
      uph: "UPH", work_efficiency: "작업효율", use_yn: "사용여부",
    },
  },
  {
    table: "customers",
    id: (r) => `${r}.customer_code`,
    type: () => lit("거래처"),
    summary: (r) => `${r}.customer_name`,
    labels: {
      customer_name: "거래처명", short_name: "약칭", customer_type: "구분", biz_reg_no: "사업자번호", ceo_name: "대표자", zip_code: "우편번호", address: "주소",
      phone: "전화번호", fax: "팩스", biz_type: "업태", biz_item: "종목", manager_name: "담당자", settle_customer_code: "정산거래처코드",
      settle_customer_name: "정산거래처명", trade_start_date: "거래시작일", trade_end_date: "거래종료일", category_large: "대분류", category_mid: "중분류",
      category_small: "소분류", bank_name: "결제은행", bank_account: "계좌번호", account_holder: "예금주", website: "웹사이트", is_purchase: "매입처",
      is_outsourcing: "외주처", is_sales: "매출처", country: "국가정보", use_yn: "사용여부",
    },
  },
  {
    table: "warehouses",
    id: (r) => `${r}.warehouse_code`,
    type: () => lit("창고"),
    summary: (r) => `${r}.warehouse_name`,
    labels: { warehouse_name: "창고명", workplace: "사업장", procure_type: "조달구분", warehouse_type: "창고구분", use_yn: "사용여부" },
  },
  {
    table: "production_calendar",
    id: (r) => `${r}.cal_date`,
    type: () => lit("생산캘린더"),
    summary: (r) => `${r}.day_type`,
    labels: { day_type: "일자구분", work_yn: "근무여부", note: "비고" },
  },
  {
    table: "process_calendar",
    id: (r) => `${r}.cal_date || '/' || ${r}.process_code`,
    type: () => lit("공정캘린더"),
    summary: (r) => `${r}.process_code`,
    labels: {
      shift1_active_override: "1교대 가동변경", shift1_ot_start: "1교대 잔업시작", shift1_ot_end: "1교대 잔업종료", shift1_ot_meal_minutes: "1교대 잔업식사분",
      shift2_active_override: "2교대 가동변경", shift2_ot_start: "2교대 잔업시작", shift2_ot_end: "2교대 잔업종료", shift2_ot_meal_minutes: "2교대 잔업식사분", note: "비고",
    },
    skip: ["id"],
  },
  {
    table: "process_uph_target",
    id: (r) => `${r}.target_year || '/' || ${r}.line_key`,
    type: () => lit("공정 목표UPH"),
    summary: (r) => `${r}.target_uph`,
    labels: { target_uph: "목표 UPH" },
    skip: ["updated_by"],
  },
  {
    table: "model_names",
    id: (r) => `${r}.model_name`,
    type: () => lit("형명"),
    summary: (r) => `${r}.permit_item`,
    labels: {
      list_no: "연번", permit_item: "허가품목", shelf_years: "유효기간(년)", uv_yn: "UV", ph: "pH", material_type: "원료 구분",
      material_code: "원료 기호", note: "비고", use_yn: "사용여부",
    },
    skip: ["updated_by"],
  },
  {
    table: "model_name_lots",
    id: (r) => `${r}.model_name || ' / ' || ${r}.raw_lot`,
    type: () => lit("형명 원료로트"),
    summary: (r) => `'형명식별 ' || ${r}.symbol`,
    labels: { model_name: "형명", raw_lot: "원료로트 식별", symbol: "형명식별 기호" },
    skip: ["id", "sort_no"],
  },
  {
    table: "workers",
    id: (r) => `${r}.employee_no`,
    type: () => lit(ENTITY_TYPE_WORKER),
    summary: (r) => `${r}.worker_name`,
    labels: {
      erp_code: "ERP코드", employee_qr: "사원QR", worker_name: "성명", phone: "연락처", hire_date: "입사일", biz_employee_no: "비즈사번", biz_dept: "비즈부서",
      ...Object.fromEntries(WORKER_TRACKED_FIELDS.map((f) => [f.key, f.label])),
    },
    trackedCols: WORKER_TRACKED_FIELDS.map((f) => f.key),
  },
];

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const HIST_COLS = "entity_type, entity_id, field, field_label, old_value, new_value, change_date, changed_by";
const TODAY_SQL = "date('now','localtime')";

export function ensureMasterHistoryTriggers(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS master_history_ctx (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    actor TEXT,
    until_sec INTEGER NOT NULL DEFAULT 0,
    skip_tracked INTEGER NOT NULL DEFAULT 0,
    trigger_version INTEGER NOT NULL DEFAULT 0
  )`);
  db.exec("INSERT OR IGNORE INTO master_history_ctx (id) VALUES (1)");
  const cur = (db.prepare("SELECT trigger_version v FROM master_history_ctx WHERE id = 1").get() as { v: number }).v;
  if (cur >= HISTORY_TRIGGER_VERSION) return;

  const stmts: string[] = [];
  for (const old of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'mdh\\_%' ESCAPE '\\'").all() as { name: string }[]) {
    stmts.push(`DROP TRIGGER IF EXISTS ${q(old.name)}`);
  }
  for (const t of HISTORY_TABLES) {
    const info = db.prepare(`PRAGMA table_info(${q(t.table)})`).all() as { name: string; pk: number }[];
    if (info.length === 0) continue; // 테이블이 아직 없는 DB
    const skip = new Set([...COMMON_SKIP, ...(t.skip ?? [])]);
    const pkCols = new Set(info.filter((c) => c.pk > 0).map((c) => c.name));
    const row = (r: string, field: string, label: string, oldV: string, newV: string) =>
      `INSERT INTO master_data_change_history (${HIST_COLS}) VALUES (${t.type(r)}, ${t.id(r)}, ${field}, ${label}, ${oldV}, ${newV}, ${TODAY_SQL}, ${ACTOR_SQL});`;
    stmts.push(
      `CREATE TRIGGER ${q(`mdh_${t.table}_ins`)} AFTER INSERT ON ${q(t.table)} BEGIN ${row("NEW", "'__insert'", "'등록'", "NULL", `CAST(${t.summary("NEW")} AS TEXT)`)} END`,
      `CREATE TRIGGER ${q(`mdh_${t.table}_del`)} AFTER DELETE ON ${q(t.table)} BEGIN ${row("OLD", "'__delete'", "'삭제'", `CAST(${t.summary("OLD")} AS TEXT)`, "NULL")} END`
    );
    for (const c of info) {
      if (skip.has(c.name) || pkCols.has(c.name)) continue;
      if (t.jsonCols?.includes(c.name)) {
        const oj = `CASE WHEN json_valid(OLD.${q(c.name)}) THEN OLD.${q(c.name)} END`;
        const nj = `CASE WHEN json_valid(NEW.${q(c.name)}) THEN NEW.${q(c.name)} END`;
        const path = (r: string) => `json_extract(${r}.${q(c.name)}, '$."' || k.key || '"')`;
        stmts.push(
          `CREATE TRIGGER ${q(`mdh_${t.table}_${c.name}`)} AFTER UPDATE OF ${q(c.name)} ON ${q(t.table)} WHEN OLD.${q(c.name)} IS NOT NEW.${q(c.name)} BEGIN
             INSERT INTO master_data_change_history (${HIST_COLS})
             SELECT ${t.type("NEW")}, ${t.id("NEW")}, ${lit(c.name + ".")} || k.key, k.key,
                    CAST(${path("OLD")} AS TEXT), CAST(${path("NEW")} AS TEXT), ${TODAY_SQL}, ${ACTOR_SQL}
               FROM (SELECT key FROM json_each(${oj}) UNION SELECT key FROM json_each(${nj})) k
              WHERE ${path("OLD")} IS NOT ${path("NEW")};
           END`
        );
        continue;
      }
      const label = t.labels[c.name] ?? c.name;
      const tracked = t.trackedCols?.includes(c.name) ? ` AND NOT ${SKIP_TRACKED_SQL}` : "";
      stmts.push(
        `CREATE TRIGGER ${q(`mdh_${t.table}_${c.name}`)} AFTER UPDATE OF ${q(c.name)} ON ${q(t.table)}
           WHEN OLD.${q(c.name)} IS NOT NEW.${q(c.name)}${tracked} BEGIN
           ${row("NEW", lit(c.name), lit(label), `CAST(OLD.${q(c.name)} AS TEXT)`, `CAST(NEW.${q(c.name)} AS TEXT)`)}
         END`
      );
    }
  }
  db.exec("BEGIN");
  try {
    for (const s of stmts) db.exec(s);
    db.exec(`UPDATE master_history_ctx SET trigger_version = ${HISTORY_TRIGGER_VERSION} WHERE id = 1`);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** API가 기준정보를 쓰기 직전에 부른다 — 이후 seconds초 안의 트리거 기록에 변경자를 붙인다. skipTracked: 작업자 추적 컬럼을 API가 직접 기록하는 경로 */
export function setHistoryActor(db: DatabaseSync, actor: string | null, opts: { seconds?: number; skipTracked?: boolean } = {}): void {
  db.prepare(
    "UPDATE master_history_ctx SET actor = ?, until_sec = CAST(strftime('%s','now') AS INTEGER) + ?, skip_tracked = ? WHERE id = 1"
  ).run(actor, opts.seconds ?? 20, opts.skipTracked ? 1 : 0);
}
