import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "./auth";
import { computeShiftMinutes } from "./shift-time";

const DB_DIR = path.join(process.cwd(), "data");
// MES_DB_FILE로 다른 DB 파일을 가리킬 수 있다 — 같은 코드/node_modules를 공유하는
// 별도 인스턴스(예: 사내 공개용 미리보기 서버)가 운영 DB(mes.db)를 건드리지 않도록.
const DB_PATH = path.join(DB_DIR, process.env.MES_DB_FILE || "mes.db");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS items (
  item_code TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  spec TEXT,
  unit TEXT NOT NULL DEFAULT 'EA',
  warehouse TEXT,
  safety_stock REAL
);

CREATE TABLE IF NOT EXISTS equipments (
  equipment_id TEXT PRIMARY KEY,
  equipment_name TEXT NOT NULL,
  workplace TEXT,
  equipment_group TEXT,
  personnel REAL,
  wage_rate REAL,
  ton REAL,
  line_id TEXT,
  bf_warehouse TEXT,
  defect_warehouse TEXT,
  defect_pattern TEXT,
  daily_work_minutes REAL,
  work_time_type TEXT,
  uph REAL,
  work_efficiency REAL,
  seq INTEGER NOT NULL DEFAULT 0,
  use_yn TEXT NOT NULL DEFAULT 'Y',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 기준정보(BASE-09) "작업자등록" — 인사관리(급여·인사평가 등)가 아니라 생산현장에서 매일
-- 실적 로그(POP, 일일작업현황 등)에 이름이 찍히는 현장직(약 120명 규모) 운영 정보를
-- 관리한다. employee_no(사번)가 자연키 — erp_code(ERP코드)는 ERP 연동용 별도 코드라
-- 사번과 다를 수 있어 UNIQUE 제약을 걸지 않는다. process_code는 공정등록(BASE-04,
-- processes.process_code)과 연결된다(화면에서 select로 강제). 2026-08-25 인원관리
-- PSN-01에서 기준정보로 이동하며 필드를 확장(사용자 요청) — 그 전엔 worker_code가
-- PK였는데, 이관 시점에 workers/daily_attendance 둘 다 비어 있어(실 데이터 없음)
-- 별도 마이그레이션 없이 이 스키마로 교체했다.
-- 2026-09-04 작업자등록.xlsx(현장 인사 원본 대장) 업로드를 위해 컬럼 확장. 원본에는
-- process_code(BASE-04 공정코드)보다 더 굵은 단위의 소속 구분(사출/인쇄/조립분리/외관검사/
-- 실링/마킹/출하포장/생산지원/OEM창고)이 있는데, "인쇄"·"조립분리"는 BASE-04의 세부
-- 공정(Base 인쇄/착색 인쇄, 조립/분리1~3) 여러 개를 함께 가리켜 1:1로 대응되지 않고
-- "생산지원"·"OEM창고"는 BASE-04에 아예 없다 — 그래서 이 원본 소속값은 별도 work_group에
-- 그대로 담고, process_code(조장 접근제어에 쓰이는 필드)는 억지로 채우지 않는다.
CREATE TABLE IF NOT EXISTS workers (
  employee_no TEXT PRIMARY KEY,
  erp_code TEXT,
  employee_qr TEXT,
  worker_name TEXT NOT NULL,
  contractor TEXT,
  process_code TEXT,
  work_group TEXT,
  -- "비즈" 근태 시스템 원본 사번(13자리)·부서 — 작업자등록(BASE-09) "비즈 연동
  -- 자동입력"으로 신규 등록할 때만 채워진다(2026-09-08 사용자 요청, PSN-05 "초과신청"
  -- 다운로드에서 사번/공정 대신 이 원본값을 그대로 내려주기 위함 — 사번 변환 공식이
  -- 원본 13자리 중 일부를 버려서 workers.employee_no로부터 되돌릴 수 없고, work_group도
  -- 비즈부서 원본 표기(예: "멸균(실링)")와 이름이 달라 되돌릴 수 없다). 비즈 연동 없이
  -- 등록됐거나 이 컬럼이 생기기 전에 등록된 작업자는 NULL — 그런 경우 PSN-05 쪽에서
  -- employee_no/work_group으로 대체 표시한다.
  biz_employee_no TEXT,
  biz_dept TEXT,
  duty TEXT,
  team TEXT,
  -- 교대조(2026-09-09 사용자 요청) — A조/B조/고정 중 소속을 표시하는 고정값일 뿐 자동
  -- 순환계산 로직은 없다. team("근무조", 1조/2조/주간고정 — 급여형태 구분)과는 별개
  -- 개념이라 분리했다. 기존 데이터엔 이 정보가 없어 전부 NULL(미지정)로 시작한다.
  shift_group TEXT,
  phone TEXT,
  hire_date TEXT,
  bus_route TEXT,
  bus_stop TEXT,
  uniform_size TEXT,
  shoe_size TEXT,
  status TEXT,
  resign_date TEXT,
  resign_reason TEXT,
  remark TEXT,
  seq INTEGER NOT NULL DEFAULT 0,
  use_yn TEXT NOT NULL DEFAULT 'Y',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 인원관리(PSN-01) "일일근태입력" 본공정 근무시간 — workers 1명당 하루 1행. 2026-09-07
-- 사용자가 준 "일일근태입력.xlsx" 양식(자공정: 정상/잔업/조출/중교/지각/조퇴/외출, 지원공정:
-- 지원공정/지원시간, 병합헤더)에 맞춰 work_type 하나로 뭉뚱그렸던 이전 구조를 갈아엎었다.
-- 근무시간(total_hours) = 정상+잔업+조출+중식교대+지원시간 을 저장 시점에 서버가 계산해
-- 저장한다(PUT 핸들러 참고). 지각/조퇴/외출은 합계에 반영하지 않고 기록용으로만 남긴다.
-- normal_hours("정상")는 2026-09-08부터 다른 항목으로 자동계산되지 않는 독립 입력값이다
-- (일괄수정 대상에 넣으려면 그래야 지각/조퇴/외출/지원 항목을 나중에 고쳐도 정상이 다시
-- 덮어써지지 않는다, 사용자 요청) — 저장분이 없는 날짜/작업자는 화면(GET)이 그날 요일
-- 기준 기본값(평일 8·토일/공휴일 0, kr-holidays.ts)을 채워서 보여줄 뿐, 저장 즉시 그
-- 값 그대로 고정된다.
-- process_code는 그날의 본공정(BASE-04 processes.process_code)을 workers.process_code에서
-- 스냅샷으로 복사해 저장하는 이전 방식을 그대로 유지한다(사용자 명시 요청) — 다만 화면의
-- "공정" 컬럼 자체는 이제 이 스냅샷이 아니라 workers.work_group을 매 조회마다 그대로
-- 보여주는 읽기전용 표시일 뿐이라(엑셀 원본 "공정" 컬럼 값이 소속 텍스트였음), 이 컬럼은
-- 현재 화면·리포트 어디에서도 안 쓰이고 스키마에만 보존돼 있다 — 나중에 필요해지면 쓸 것.
CREATE TABLE IF NOT EXISTS work_hours_daily (
  work_date TEXT NOT NULL,
  employee_no TEXT NOT NULL REFERENCES workers(employee_no),
  process_code TEXT REFERENCES processes(process_code),
  -- 휴가(그날 하루 연차/공가 여부) — 근무시간 합계 공식과는 무관한 별도 기록용 표시일
  -- 뿐이다(2026-09-07 사용자 요청, 엑셀 원본에는 없던 항목을 새로 추가).
  leave_type TEXT,
  normal_hours REAL NOT NULL DEFAULT 0,
  overtime_hours REAL NOT NULL DEFAULT 0,
  early_start_hours REAL NOT NULL DEFAULT 0,
  lunch_shift_hours REAL NOT NULL DEFAULT 0,
  late_hours REAL NOT NULL DEFAULT 0,
  early_leave_hours REAL NOT NULL DEFAULT 0,
  outing_hours REAL NOT NULL DEFAULT 0,
  total_hours REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (work_date, employee_no)
);

-- 인원관리(PSN-01) "일일근태입력" 지원공정 상세 — 행 하나당 지원공정 1곳 + 지원시간(화면상
-- 1인 1일 1개뿐, 자연키 work_date+employee_no). 지원공정은 BASE-04 세부 공정코드가 아니라
-- work_group(작업자등록 "공정"과 같은 9개 소속 분류, src/lib/work-groups.ts) 중 선택 —
-- 엑셀 원본의 "공정"·"지원공정" 값이 둘 다 work_group 텍스트였던 것과 맞춰 FK 없이 자유텍스트로
-- 둔다(workers.work_group과 같은 이유). PSN-04 "공정별근무현황"의 지원 매트릭스는 이 테이블을
-- workers와 employee_no로 조인해 "어느 소속(work_group)이 어느 소속을 지원했는지" 집계한다.
CREATE TABLE IF NOT EXISTS work_support_detail (
  work_date TEXT NOT NULL,
  employee_no TEXT NOT NULL REFERENCES workers(employee_no),
  support_work_group TEXT NOT NULL,
  support_hours REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (work_date, employee_no)
);

-- 인원관리(PSN-02) "출퇴근카드등록" — 카드(출입증) 태깅 기반 근태관리 시스템에서 뽑은
-- 원본 리포트(사원번호/조직/이름/근무일자/출근·퇴근시간/지각·외출·연장·야간시간 등 28컬럼)를
-- 그대로 업로드한다. "원본 엑셀 그대로 업로드 + JSON detail 컬럼" 표준 패턴(구매발주등록
-- PUR-01 등과 동일) — 사원번호+근무일자가 원본에서 항상 유일해(2026-09-07 실제 파일로
-- 확인) record_key를 "사원번호|근무일자"로 잡는다. PSN-01(일일근태입력, 조장이 직접
-- 입력)과는 완전히 별개 데이터로, 서로 자동 연동되지 않는다. 업로드된 원본 값은 화면에서
-- 행 단위 수정/선택 일괄변경으로 사람이 고쳐 쓸 수 있다(2026-09-07 사용자 요청,
-- src/app/api/attendance-card-status/[id]/route.ts) — 수정해도 uploaded_at(엑셀 업로드
-- 시각)은 안 바뀐다, 그다음 같은 구간을 다시 업로드하면 그 구간은 통째로 지워지고 파일
-- 내용으로 재입력되니 수정한 값도 함께 사라진다(구간 재동기화 방식이라 어쩔 수 없음).
CREATE TABLE IF NOT EXISTS attendance_card_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_key TEXT UNIQUE,
  employee_no TEXT,
  work_date TEXT,
  org TEXT,
  worker_name TEXT,
  team TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  detail TEXT
);

-- 인원관리(PSN-03) "보호구지급관리" 보호구품목 마스터 — 지금은 고정 3종(방진복&조끼/
-- 방진화&안전화/깔창)만 존재하고 화면에서 편집하지 않는다(migrate()에서 1회 시드).
-- cycle_type='single'은 매 지급마다 같은 주기(repeat_months)로 반복되고, 아직 한 번도
-- 지급 안 한 상태의 다음지급예정일은 정의하지 않는다(미지급으로 표시). cycle_type=
-- 'first_then_repeat'(깔창)는 최초 지급 전까지는 입사일+first_issue_months가 다음지급
-- 예정일이고, 최초 지급 이후로는 single과 동일하게 마지막 지급일+repeat_months로 반복된다.
CREATE TABLE IF NOT EXISTS ppe_items (
  item_code TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  cycle_type TEXT NOT NULL,
  first_issue_months INTEGER,
  repeat_months INTEGER NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  use_yn TEXT NOT NULL DEFAULT 'Y'
);

-- 인원관리(PSN-03) "보호구지급관리" 지급이력 — 작업자×보호구품목별 지급 1건이 한 행.
-- issue_seq(지급차수)와 next_due_date(다음지급예정일)는 등록 시점에 서버가 계산해
-- 그대로 저장한다(src/app/api/ppe-issuances). issue_seq는 재발급 순번이 뒤섞이지
-- 않도록 항상 "그 작업자×품목의 기존 최대 차수+1"로 매긴다(중간 이력을 삭제해도 다음
-- 등록이 그 차수와 충돌하지 않도록).
CREATE TABLE IF NOT EXISTS ppe_issuances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_no TEXT NOT NULL REFERENCES workers(employee_no),
  item_code TEXT NOT NULL REFERENCES ppe_items(item_code),
  issue_date TEXT NOT NULL,
  issue_seq INTEGER NOT NULL,
  next_due_date TEXT,
  received_yn TEXT NOT NULL DEFAULT 'Y',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (employee_no, item_code, issue_seq)
);

CREATE TABLE IF NOT EXISTS sales_orders (
  so_no TEXT PRIMARY KEY,
  customer_code TEXT NOT NULL REFERENCES customers(customer_code),
  item_code TEXT NOT NULL REFERENCES items(item_code),
  order_qty REAL NOT NULL,
  unit_price REAL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT '수주',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS work_orders (
  wo_no TEXT PRIMARY KEY,
  item_code TEXT NOT NULL REFERENCES items(item_code),
  line_id TEXT NOT NULL,
  order_qty REAL NOT NULL,
  produced_qty REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '대기',
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  issued_at TEXT,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS lots (
  lot_no TEXT PRIMARY KEY,
  wo_no TEXT REFERENCES work_orders(wo_no),
  item_code TEXT NOT NULL REFERENCES items(item_code),
  qty REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '정상',
  lot_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS production_results (
  result_id TEXT PRIMARY KEY,
  wo_no TEXT NOT NULL REFERENCES work_orders(wo_no),
  lot_no TEXT NOT NULL REFERENCES lots(lot_no),
  equipment_id TEXT REFERENCES equipments(equipment_id),
  qty REAL NOT NULL,
  reg_time TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS defects (
  defect_id TEXT PRIMARY KEY,
  wo_no TEXT NOT NULL REFERENCES work_orders(wo_no),
  lot_no TEXT REFERENCES lots(lot_no),
  defect_type TEXT NOT NULL,
  qty REAL NOT NULL,
  reg_time TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS material_inputs (
  input_id TEXT PRIMARY KEY,
  wo_no TEXT NOT NULL REFERENCES work_orders(wo_no),
  material_lot_no TEXT NOT NULL REFERENCES lots(lot_no),
  qty REAL NOT NULL,
  reg_time TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS inventory (
  inventory_id TEXT PRIMARY KEY,
  item_code TEXT NOT NULL REFERENCES items(item_code),
  lot_no TEXT NOT NULL REFERENCES lots(lot_no),
  location TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '정상',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(item_code, lot_no, location)
);

CREATE TABLE IF NOT EXISTS bom (
  bom_id TEXT PRIMARY KEY,
  parent_item_code TEXT NOT NULL REFERENCES items(item_code),
  child_item_code TEXT NOT NULL REFERENCES items(item_code),
  qty_per REAL NOT NULL,
  unit TEXT,
  UNIQUE(parent_item_code, child_item_code)
);

-- BOM관리(BASE-03) "신규 모델 추가" 이력 — 이 화면(신규 모델 추가 폼) 또는 엑셀 업로드로
-- 기준정보에 없던 완제품이 새로 등록된 시점만 기록한다(기존 완제품의 BOM 수정은 포함 안 함).
CREATE TABLE IF NOT EXISTS bom_model_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  source TEXT NOT NULL,
  child_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS processes (
  process_code TEXT PRIMARY KEY,
  process_name TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  procure_type TEXT,
  productivity_type TEXT,
  process_group TEXT,
  process_group2 TEXT,
  single_process TEXT,
  use_yn TEXT NOT NULL DEFAULT 'Y',
  reg_date TEXT,
  reg_by TEXT,
  -- 계획정보(PLAN-02)에서 품목×공정별 값을 따로 입력하지 않으면 이 기본값을 따른다.
  default_daily_capa REAL,
  default_yield_rate REAL,
  default_lot_size REAL,
  -- 생산캘린더(BASE-08) "기본 근무패턴" — 이 공정의 표준 1조/2조 시작·종료시각과
  -- 기본작업시간(식사 제외 순작업분). 미설정(NULL)이면 화면에서 가동 Y·480분으로
  -- 취급한다(공정별 패턴을 아직 등록 안 한 기존 공정도 그대로 동작하도록).
  shift1_active_yn TEXT NOT NULL DEFAULT 'Y',
  shift1_start TEXT,
  shift1_end TEXT,
  shift1_base_minutes REAL,
  shift2_active_yn TEXT NOT NULL DEFAULT 'Y',
  shift2_start TEXT,
  shift2_end TEXT,
  shift2_base_minutes REAL,
  -- "공정 사용/중단"(use_yn)과 별개 — 이 공정을 생산캘린더(BASE-08) 근무시간 계산
  -- 대상에 포함할지 여부. N이면 실적등록 등에는 계속 쓰이되 캘린더 계산에서만 빠진다.
  apply_work_pattern_yn TEXT NOT NULL DEFAULT 'Y',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 생산캘린더(BASE-08) "날짜 × 공정" 예외(오버라이드). 대부분의 날짜/공정 조합은 행이
-- 없고, 회사 공통 근무구분(production_calendar)과 공정 표준 패턴(processes)에서 계산한
-- 기본값을 그대로 쓴다 — 휴무 지정·잔업 추가 등 "이 날짜, 이 공정만" 다를 때만 행이 생긴다.
CREATE TABLE IF NOT EXISTS process_calendar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cal_date TEXT NOT NULL,
  process_code TEXT NOT NULL REFERENCES processes(process_code),
  shift1_active_override TEXT,
  shift1_ot_start TEXT,
  shift1_ot_end TEXT,
  shift1_ot_meal_minutes REAL,
  shift2_active_override TEXT,
  shift2_ot_start TEXT,
  shift2_ot_end TEXT,
  shift2_ot_meal_minutes REAL,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(cal_date, process_code)
);

-- 계획정보(PLAN-02) — 품목×공정별 일CAPA/생산수율/Lot Size. 세 값 모두 비워두면
-- processes의 기본값(default_daily_capa 등)을 그대로 쓴다(화면/API에서 fallback 처리).
CREATE TABLE IF NOT EXISTS item_process_routing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT NOT NULL REFERENCES items(item_code),
  process_code TEXT NOT NULL REFERENCES processes(process_code),
  daily_capa REAL,
  yield_rate REAL,
  lot_size REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(item_code, process_code)
);

CREATE TABLE IF NOT EXISTS customers (
  customer_code TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_type TEXT,
  biz_reg_no TEXT,
  ceo_name TEXT,
  zip_code TEXT,
  address TEXT,
  phone TEXT,
  fax TEXT,
  biz_type TEXT,
  biz_item TEXT,
  manager_name TEXT,
  settle_customer_code TEXT,
  settle_customer_name TEXT,
  trade_start_date TEXT,
  trade_end_date TEXT,
  category_large TEXT,
  category_mid TEXT,
  category_small TEXT,
  bank_name TEXT,
  bank_account TEXT,
  account_holder TEXT,
  website TEXT,
  is_purchase TEXT NOT NULL DEFAULT 'N',
  is_outsourcing TEXT NOT NULL DEFAULT 'N',
  is_sales TEXT NOT NULL DEFAULT 'N',
  country TEXT,
  seq INTEGER NOT NULL DEFAULT 0,
  use_yn TEXT NOT NULL DEFAULT 'Y',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS warehouses (
  warehouse_code TEXT PRIMARY KEY,
  warehouse_name TEXT NOT NULL,
  workplace TEXT,
  procure_type TEXT,
  warehouse_type TEXT,
  seq INTEGER NOT NULL DEFAULT 0,
  use_yn TEXT NOT NULL DEFAULT 'Y',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 현재고현황(INV-02)/공정재공현황(INV-03): 원본 ERP 엑셀을 그대로 업로드하는 스냅샷
-- 리포트. 매번 전체 교체(업로드 시 기존 행 삭제 후 재적재)되므로 자동증가 id만 두고,
-- 검색/조회에 자주 쓰는 값만 실컬럼으로 뽑아내고 나머지 원본 컬럼 전체는 detail(JSON)에 담는다.
CREATE TABLE IF NOT EXISTS inventory_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT,
  lot_no TEXT,
  warehouse TEXT,
  stock_qty REAL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  detail TEXT
);

CREATE TABLE IF NOT EXISTS process_wip_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT,
  wo_no TEXT,
  lot_no TEXT,
  so_no TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  detail TEXT
);

-- 생산관리 "작업지시현황(PROD-05)" 화면 — ERP 작업지시 실적 리포트(d_pmmr540) 엑셀
-- 업로드. 원본이 연간 누적 리포트라(수만 행) 기간을 나눠 여러 번 업로드하는 경우가
-- 많은데, 업로드마다 파일의 지시일자 최소~최대 구간을 구해 그 구간의 기존 데이터를
-- 통째로 지우고 파일 내용으로 새로 채우는 "구간 재동기화" 방식을 쓴다(구간 밖 데이터는
-- 유지). 작업지시번호(wo_no)는 원본 기준 유일해 UNIQUE 제약을 두고 upsert로 넣는다.
-- order_date는 원본 "YYYY.MM.DD" 표기를 "YYYY-MM-DD"로 정규화해 저장(필터/구간
-- 계산용), 원본 표기는 detail JSON에 그대로 남는다.
-- (이 리포트로 별도 테이블 defect_status "불량종합현황"도 PROD-05 코드로 만들었으나
-- work_order_status와 완전히 중복된 잘못된 화면이라 삭제되어, 이후 work_order_status가
-- PROD-05를 이어받았다. 진짜 불량 유형 데이터는 defect_type_status/PROD-07 참고.)
CREATE TABLE IF NOT EXISTS work_order_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_no TEXT UNIQUE,
  order_date TEXT,
  item_code TEXT,
  lot_no TEXT,
  so_no TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  detail TEXT
);

-- 생산관리 "불량종합현황(PROD-07)" 화면 — ERP 불량 유형별 리포트(d_pmmr8c0) 엑셀 업로드.
-- work_order_status(PROD-05)와 같은 이유로 "구간 재동기화" 방식을 쓴다: 업로드마다
-- 파일의 생산일자 최소~최대 구간을 구해 그 구간의 기존 데이터를 지우고 새로 채운다.
-- 처음 "불량종합현황"이라는 이름으로 올라온 파일은 실제로는 작업지시 실적 리포트
-- (d_pmmr540, work_order_status/PROD-05가 이미 보관)였고, 이후 진짜 불량 유형(깨짐/이물/도수불량 등
-- 60여 개) 데이터가 같은 파일명으로 다시 올라와 별도 화면으로 분리했다. 원본 헤더에
-- "기타"가 두 번 나와 JSON 키가 겹치므로, 두 번째는 내부적으로 "기타2"로 구분한다
-- (표시 제목은 원본과 동일하게 "기타"). record_key(지시번호|LOT No|설비코드|공정명|
-- 생산일자)에 UNIQUE 제약을 두고 upsert로 넣는다.
CREATE TABLE IF NOT EXISTS defect_type_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_key TEXT UNIQUE,
  order_date TEXT,
  item_code TEXT,
  wo_no TEXT,
  lot_no TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  detail TEXT
);

-- 영업관리 "제품출고등록(SALES-03)" 화면 — ERP 출고 실적 리포트(d_smmr430) 엑셀 업로드.
-- 원본이 연초부터의 누적 로그라(수만 행) 다른 대용량 리포트와 같은 이유로 업로드마다
-- 지우지 않고 누적하며, 출고번호(shipment_no, 원본 기준 유일 — PO 라인별로 이미
-- "P2202601060001-1"처럼 일련번호가 붙어 있음)가 다시 업로드되면 덮어쓰기(upsert)만
-- 한다. ship_date는 원본 "YYYY.MM.DD" 표기를 "YYYY-MM-DD"로 정규화해 저장(필터용).
CREATE TABLE IF NOT EXISTS product_shipment_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_no TEXT UNIQUE,
  ship_date TEXT,
  item_code TEXT,
  customer_code TEXT,
  so_no TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  detail TEXT
);

-- 구매관리 "구매발주등록(PUR-01)" 화면 — ERP 발주 리포트(d_phmr210) 엑셀 업로드.
-- 발주 1건이 품목별로 여러 행(순번 1,2,3...)으로 나뉘므로 발주번호만으론 유일하지 않아
-- record_key(발주번호|순번)에 UNIQUE 제약을 두고 자연키로 upsert한다. 원본이 2018년
-- 부터의 누적 로그라(1만행+) 기간을 나눠 여러 번 업로드하는 경우가 많은데,
-- work_order_status(PROD-05)와 같은 이유로 "구간 재동기화" 방식을 쓴다: 업로드마다
-- 파일의 발주일자 최소~최대 구간을 구해 그 구간의 기존 데이터를 지우고 새로 채운다.
-- order_date(발주일자)는 원본 "YYYY.MM.DD" 표기를 "YYYY-MM-DD"로 정규화해 저장
-- (필터/정렬/구간 계산용).
CREATE TABLE IF NOT EXISTS purchase_order_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_key TEXT UNIQUE,
  order_date TEXT,
  item_code TEXT,
  customer_code TEXT,
  po_no TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  detail TEXT
);

-- 구매관리 "구매입고등록(PUR-02)" 화면 — ERP 입고 실적 리포트(d_phmr320) 엑셀 업로드.
-- 입고 1건도 품목별로 여러 행(순번)으로 나뉘므로 record_key(입고전표번호|순번)에 UNIQUE
-- 제약을 두고 자연키로 upsert한다. 원본이 2018년부터의 누적 로그라(4만행+) 기간을
-- 나눠 여러 번 업로드하는 경우가 많은데, work_order_status(PROD-05)와 같은 이유로
-- "구간 재동기화" 방식을 쓴다: 업로드마다 파일의 입고일 최소~최대 구간을 구해 그
-- 구간의 기존 데이터를 지우고 새로 채운다. receipt_date(입고일)는 원본 "YYYY.MM.DD"
-- 표기를 "YYYY-MM-DD"로 정규화해 저장(필터/정렬/구간 계산용).
CREATE TABLE IF NOT EXISTS purchase_receipt_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_key TEXT UNIQUE,
  receipt_date TEXT,
  item_code TEXT,
  customer_code TEXT,
  receipt_no TEXT,
  lot_no TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  detail TEXT
);

-- 재고관리 "MOLD입고현황(INV-04)" 화면 — ERP 몰드(금형) 입고 리포트 엑셀 업로드.
-- purchase_receipt_status(PUR-02)와 원본 모양이 거의 같다: 입고 1건이 LOT별로 여러 행
-- (순번)으로 나뉘어 입고전표번호만으론 유일하지 않으므로 record_key(입고전표번호|순번)에
-- UNIQUE 제약을 두고 자연키로 upsert한다. 다만 거래처가 아니라 입고창고 기준이라
-- customer_code 대신 warehouse를 둔다. 원본이 2025년부터의 누적 로그라(10만행 안팎)
-- 기간을 나눠 여러 번 업로드하는 경우가 많은데, work_order_status(PROD-05)와 같은
-- 이유로 "구간 재동기화" 방식을 쓴다: 업로드마다 파일의 입고일 최소~최대 구간을 구해
-- 그 구간의 기존 데이터를 지우고 새로 채운다. receipt_date(입고일)는 원본 "YYYY.MM.DD"
-- 표기를 "YYYY-MM-DD"로 정규화해 저장(필터/정렬/구간 계산용).
CREATE TABLE IF NOT EXISTS mold_receipt_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_key TEXT UNIQUE,
  receipt_date TEXT,
  item_code TEXT,
  warehouse TEXT,
  receipt_no TEXT,
  lot_no TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  detail TEXT
);

-- 재고관리 "창고이동현황(INV-05)" 화면 — ERP 창고간 이동 리포트(d_mmmr010) 엑셀 업로드.
-- mold_receipt_status(INV-04)와 같은 모양이지만 창고가 출고/입고 둘이라 warehouse
-- 하나 대신 from_warehouse/to_warehouse 둘을 둔다(출고품목=입고품목이 원본에서 항상
-- 같음을 확인해 item_code는 하나만 둔다). 이동 1건이 품목별로 여러 행(순번)으로 나뉘어
-- 이동번호만으론 유일하지 않으므로 record_key(이동번호|순번)에 UNIQUE 제약을 두고
-- 자연키로 upsert한다. 원본이 누적 로그라 기간을 나눠 여러 번 업로드하는 경우가 많은데,
-- 다른 대용량 리포트와 같은 이유로 "구간 재동기화" 방식을 쓴다: 업로드마다 파일의
-- 이동일자 최소~최대 구간을 구해 그 구간의 기존 데이터를 지우고 새로 채운다.
-- transfer_date(이동일자)는 원본 "YYYY.MM.DD" 표기를 "YYYY-MM-DD"로 정규화해 저장
-- (필터/정렬/구간 계산용).
CREATE TABLE IF NOT EXISTS warehouse_transfer_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_key TEXT UNIQUE,
  transfer_date TEXT,
  item_code TEXT,
  from_warehouse TEXT,
  to_warehouse TEXT,
  transfer_no TEXT,
  lot_no TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  detail TEXT
);

-- 생산관리 "도수변경등록(PROD-06)" 화면 — ERP 조립 실적 리포트(d_pmmr543) 엑셀 업로드.
-- 조립 LOT마다 투입되는 자재(BASE/착색 등) 단위로 한 행씩 잡혀 원본 헤더에 "주야간"이
-- 두 번(작업 주야간·검사 주야간) 나오는데, JSON 키가 겹치지 않도록 두 번째는 내부적으로
-- "검사주야간"으로 구분해 저장한다(표시 제목은 원본과 동일하게 "주야간"). record_key
-- (작업지시번호|LOT No|조립투입LOT No|조립투입품목)에 UNIQUE 제약을 두고 upsert로
-- 넣는다. work_order_status(PROD-05)와 같은 이유로 "구간 재동기화" 방식을 쓴다:
-- 업로드마다 파일의 검사일자 최소~최대 구간을 구해 그 구간의 기존 데이터를 지우고
-- 새로 채운다. order_date(지시일자)는 PROD-06 화면 자체 필터/정렬용이고, inspect_date(검사일자 —
-- 외관검사 일자)는 품질관리 "도수변경현황(QC-01)"이 별도로 쓴다(같은 조립 실적도
-- 지시일자와 검사일자가 다를 수 있어 목적에 따라 다른 날짜 기준이 필요). 재동기화 구간은
-- 검사일자 기준으로 잡는다: QC-01이 검사일자로 조회하므로 그 기준과 어긋나면 안 된다.
CREATE TABLE IF NOT EXISTS dosu_change_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_key TEXT UNIQUE,
  order_date TEXT,
  inspect_date TEXT,
  item_code TEXT,
  wo_no TEXT,
  lot_no TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  detail TEXT
);

-- 생산관리 "일일작업현황(PROD-10)" 화면 — ERP 실적 로그 엑셀 업로드. 원본 파일이 너무
-- 커서(수십만 행) 기간을 나눠 여러 번 업로드하는 경우가 많다. work_order_status
-- (PROD-05)와 같은 이유로 "구간 재동기화" 방식을 쓴다: 업로드마다 파일의 작업일자
-- 최소~최대 구간을 구해 그 구간의 기존 데이터를 지우고 새로 채운다(구간 밖 데이터는
-- 유지). record_key(작지번호|공정코드|LOT No|공정순서|등록시각)에 UNIQUE 제약을 두고
-- upsert로 넣는다. work_date는 원본 "YYYY.MM.DD" 표기를 "YYYY-MM-DD"로 정규화해
-- 저장(필터/구간 계산용), 원본 표기는 detail JSON에 그대로 남는다.
CREATE TABLE IF NOT EXISTS daily_work_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_key TEXT,
  work_date TEXT,
  item_code TEXT,
  process_code TEXT,
  wo_no TEXT,
  lot_no TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  detail TEXT
);

-- 경영정보 "월별수주현황(MGMT-02)" 화면의 계획(목표) 수량. 실적(수주량)은 항상
-- sales_orders에서 실시간 집계하고, 이 표의 plan_qty와 대비해 달성율을 계산한다.
-- 영업 계획은 MES 외부(영업팀 계획표)에서 오는 값이라 별도 테이블로 둔다.
CREATE TABLE IF NOT EXISTS sales_monthly_plan (
  month TEXT PRIMARY KEY,
  plan_qty REAL NOT NULL DEFAULT 0,
  unplanned_qty REAL NOT NULL DEFAULT 0,
  plan_amount REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 영업관리 "월별수주(목표) 등록(SALES-01)" — 연/월/고객사별 수주 목표수량을 직접 입력해 관리한다.
-- sales_monthly_plan(월 전체 목표)과 달리 고객사 단위로 더 세분화된 목표치다.
CREATE TABLE IF NOT EXISTS sales_monthly_customer_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  customer_code TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(year, month, customer_code)
);

-- 생산캘린더(BASE-08) "회사 공통" 레이어 — 날짜별 근무구분(평일/휴일/특근)·근무여부(Y/N)·
-- 비고. 등록되지 않은 날짜는 행이 없고 화면에서 "미등록"으로 표시된다. 공정마다 표준
-- 근무시간대가 달라(착색 1조 07-16시 vs 조립 등) 조별 근무시간은 여기 두지 않고
-- processes(공정 표준 패턴) + process_calendar(날짜×공정 예외)에서 관리한다.
-- 로그인 계정. role='leader'(조장)은 소속공정(user_processes, 복수 가능)만 조회/수정
-- 가능하고 사이드바에도 작업자등록(BASE-09)/일일근태입력(PSN-01)만 보인다(2026-09-07
-- 출퇴근등록 PSN-02 삭제 후 기본값에서도 제외 — src/lib/permissions.ts#LEADER_DEFAULT_CODES
-- 참고). role='admin'(관리자)은 전체 메뉴/전체 공정 접근. 비밀번호는 scrypt(hash+salt)로 저장한다
-- (src/lib/auth.ts). 소속공정은 원래 이 표의 단일 컬럼(process_code)이었다가 조장 한
-- 명이 여러 공정을 겸임하는 경우를 지원하기 위해 user_processes 조인테이블로 옮겼다
-- (2026-09, migrate() 참고 — 기존 값은 자동 백필되고 컬럼은 제거된다).
-- team/employment_type/position: 회사 조직구조 분류(소속팀/구분/직급, src/lib/org.ts가
-- 유효값 목록의 단일 소스) — 지금은 계정에 붙는 순수 메타데이터일 뿐 권한 계산에는
-- 쓰이지 않는다. 이후 별도 작업에서 이 조합별 화면 접근권한 기본값 매핑 규칙을 추가할
-- 예정이라 미리 컬럼을 마련해 둔다. position은 employment_type 없이는 의미가 없어
-- (관리직/현장직마다 다른 직급 목록) 항상 함께 채워지거나 함께 비어 있어야 한다
-- (API에서 검증, src/app/api/users).
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'leader',
  use_yn TEXT NOT NULL DEFAULT 'Y',
  team TEXT,
  employment_type TEXT,
  position TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 사용자별 소속공정(복수) — role='leader' 계정이 조회/수정 가능한 공정 범위. 관리자는
-- 이 표를 참조하지 않고 전체 공정에 접근한다(src/app/api/workers, src/app/api/attendance
-- 의 leader 스코핑 로직 참고). 2026-09-04: process_code는 원래 BASE-04 processes.process_code를
-- 참조하는 FK였는데, 작업자등록(BASE-09)의 "공정"이 BASE-04 세부공정 대신 work_group
-- 자유텍스트(사출/인쇄/조립분리/외관검사/실링/마킹/출하포장/생산지원/OEM창고)로 바뀌면서
-- 소속공정도 같은 값을 써야 필터링이 맞물려, processes에 대한 FK를 없앴다(컬럼명
-- process_code는 기존 코드 전반과의 일관성을 위해 그대로 두되, 실제로 담기는 값은 이제
-- workers.work_group과 같은 자유텍스트다).
CREATE TABLE IF NOT EXISTS user_processes (
  username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  process_code TEXT NOT NULL,
  PRIMARY KEY (username, process_code)
);

-- 사용자계정관리(SYS-01) 화면단위 접근권한 예외. role(조장/관리자)이 기본값이고, 이 표는
-- 그 기본값과 "다르게" 설정한 화면만 예외로 저장한다 — 체크 상태가 role 기본값과 같으면
-- 행을 아예 만들지 않는다(src/app/api/users/[username]/permissions/route.ts). allowed='Y'는
-- role 기본이 접근불가여도 이 화면만 허용, 'N'은 role 기본이 접근가능이어도 이 화면만 차단.
-- 로그인 시점(src/app/api/auth/login)에 role 기본값과 합쳐 세션에 최종 허용 화면 목록으로
-- 굽는다(role/소속공정과 같은 신선도 — 예외를 바꾸면 대상 사용자가 재로그인해야 반영됨).
CREATE TABLE IF NOT EXISTS user_permissions (
  username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  screen_code TEXT NOT NULL,
  allowed TEXT NOT NULL,
  PRIMARY KEY (username, screen_code)
);

CREATE TABLE IF NOT EXISTS production_calendar (
  cal_date TEXT PRIMARY KEY,
  day_type TEXT NOT NULL DEFAULT '평일',
  work_yn TEXT NOT NULL DEFAULT 'Y',
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 인원관리(PSN-07) "근무시간정보" — 조(1조/2조)별 근무시간표 구간(조출/1Q/휴식/2Q/식사/
-- 3Q/잔업 등, 조마다 구간 구성·개수가 달라 segment_name은 자유텍스트+추천 목록). 근태대사
-- (PSN-06)가 이후 지각/조출/잔업 판정 기준으로 이 표를 참조할 예정이라(2026-09-09 사용자
-- 명시, 다음 단계에서 연동 예정 — 지금은 이 화면만 만든다) 시작~종료 시각과 근로시간(분,
-- 클라이언트 값을 신뢰하지 않고 서버가 shift-time.ts의 computeShiftMinutes로 계산해
-- 저장)을 명확히 구조화해 둔다. effective_date는 이 구간 세트가 언제부터 적용되는지 —
-- 나중에 시간표가 개정되면 새 effective_date로 같은 조에 새 구간 세트를 추가하고 기존
-- 행은 지우지 않고 이력으로 남긴다(자연키 없음, id만으로 식별). 지금 화면은 저장된 모든
-- 행을 조·적용시작일·seq 순으로 그대로 보여줄 뿐 "현재 적용 중인 버전"을 자동으로 골라내는
-- 로직은 없다 — 그건 PSN-06 연동 시점에 필요해지면 추가한다.
CREATE TABLE IF NOT EXISTS shift_time_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_code TEXT NOT NULL,
  segment_name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  work_minutes INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- "기준정보 변경이력"(BASE-10, 2026-09-09 신설, 처음엔 "작업자 변경이력"으로 좁게
-- 설계했다가 같은 날 바로 범용 통합 이력으로 재설계됨) — 품목/자재/BOM/설비/거래처/
-- 창고/작업자 등 모든 기준정보(BASE-0x)의 필드 변경을 entity_type(대상유형, "작업자"
-- 등 한글 라벨 그대로) + entity_id(대상ID, 사번/품목코드 등 그 유형의 식별자) 조합으로
-- 한 테이블에 같이 쌓는다 — 대상유형마다 식별자 형식이 달라 entity_id에 FK를 걸 수
-- 없다(작업자는 workers.employee_no, 품목은 items.item_code 등 서로 다른 테이블/타입).
-- field는 내부 컬럼키(work_group 등), field_label은 그 시점 한글 라벨 스냅샷(나중에
-- 라벨이 바뀌어도 과거 이력 표시는 안 흔들리게). change_date는 등록일시(created_at)의
-- 날짜와 항상 동일하게 자동 기록(수동 소급 입력 UI는 아직 없음). changed_by는 로그인
-- 세션 username. 지금은 src/lib/master-data-history.ts의 WORKER_TRACKED_FIELDS로
-- entity_type='작업자'(공정/근무조/교대조/직무/도급사/사용여부)만 실제로 기록되고
-- 있고, 다른 기준정보는 각 API에 같은 방식으로 로깅을 추가하면 이 테이블에 자연히
-- 같이 쌓인다(스키마 변경 불필요). 근무시간조회(PSN-05)·근태대사(PSN-06)가
-- entity_type='작업자' AND field='work_group' 이력을 참조해 특정 날짜 기준
-- "그 당시 공정"을 재구성한다(resolveFieldAsOf).
CREATE TABLE IF NOT EXISTS master_data_change_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  field_label TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  change_date TEXT NOT NULL,
  changed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_master_data_change_history_entity
  ON master_data_change_history(entity_type, entity_id, field, change_date);

-- 계획정보(PLAN-02) "공정별 월 CAPA 및 근무계획" — 라인(사출_상/착색/조립 등, BASE-04
-- 세부공정코드 묶음, src/lib/production-plan-lines.ts 참고)별로 그 달의 "공정별 계획"
-- (일CAPA)·"비고"만 사람이 입력해 저장한다. 인원/근무일수/생산성/운영계획은 전부
-- 작업자등록(BASE-09)·생산캘린더(BASE-08)에서 그때그때 계산하는 값이라 저장하지 않는다
-- — 이 테이블은 시스템에 근거 데이터 자체가 없는 "일CAPA"/"비고" 두 가지만 사람이 매달
-- 입력해두는 용도(2026-09-13 사용자 확인, 첨부 생산계획 엑셀의 수치가 BASE-04
-- default_daily_capa와 맞지 않아 새로 만듦. 비고는 같은 날 추가 요청으로 함께 추가 —
-- 간접직 자동 집계 텍스트는 값을 비워뒀을 때만 보여주는 기본값으로 남긴다).
CREATE TABLE IF NOT EXISTS line_capa_plan (
  year_month TEXT NOT NULL,
  line_key TEXT NOT NULL,
  daily_capa REAL,
  remark TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by TEXT,
  PRIMARY KEY (year_month, line_key)
);
`;

function migrate(db: DatabaseSync) {
  const cols = db.prepare("PRAGMA table_info(items)").all() as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("warehouse")) {
    db.exec("ALTER TABLE items ADD COLUMN warehouse TEXT");
  }
  if (!colNames.has("safety_stock")) {
    db.exec("ALTER TABLE items ADD COLUMN safety_stock REAL");
  }
  if (!colNames.has("use_yn")) {
    db.exec("ALTER TABLE items ADD COLUMN use_yn TEXT NOT NULL DEFAULT 'Y'");
    // 기존 행은 원본 엑셀 사용여부(detail JSON)로 백필
    if (colNames.has("detail")) {
      db.exec(
        "UPDATE items SET use_yn = COALESCE(json_extract(detail, '$.사용여부'), 'Y')"
      );
    }
  }

  // sales_orders: 원본 "수주현황" 엑셀 전체 컬럼(detail JSON) 및 수동 등록분의
  // MO-번호/순번/샘플구분/단가구분/비고 보관용 컬럼.
  const soCols = db.prepare("PRAGMA table_info(sales_orders)").all() as { name: string }[];
  if (soCols.length > 0 && !soCols.some((c) => c.name === "detail")) {
    db.exec("ALTER TABLE sales_orders ADD COLUMN detail TEXT");
  }

  // work_orders: 작업지시등록(PROD-03) 화면에서 수주 선택 시 자동 생성되는 작업지시가
  // 원본 수주(so_no)를 참조하고, 라인/순서/긴급/Release사용/의뢰번호/비고 및 품목
  // 마스터에서 스냅샷한 렌즈 속성(직경/포장방법/캡실링지/Tone/형명/BC/렌즈구분/주기/
  // Radius/BOM/입고창고)을 detail JSON에 담을 수 있게 한다.
  const woCols = db.prepare("PRAGMA table_info(work_orders)").all() as { name: string }[];
  if (woCols.length > 0 && !woCols.some((c) => c.name === "so_no")) {
    db.exec("ALTER TABLE work_orders ADD COLUMN so_no TEXT");
  }
  if (woCols.length > 0 && !woCols.some((c) => c.name === "detail")) {
    db.exec("ALTER TABLE work_orders ADD COLUMN detail TEXT");
  }

  // processes: 최초 설계(process_type/line_id/standard_time)를 실제 원본
  // "공정코드등록.xlsx" 컬럼 구조로 교체 — 이전 스키마의 시드 데이터만
  // 있었으므로 안전하게 재생성한다.
  const procCols = db.prepare("PRAGMA table_info(processes)").all() as {
    name: string;
  }[];
  if (procCols.length > 0 && !procCols.some((c) => c.name === "procure_type")) {
    db.exec("DROP TABLE processes");
    db.exec(`
      CREATE TABLE processes (
        process_code TEXT PRIMARY KEY,
        process_name TEXT NOT NULL,
        seq INTEGER NOT NULL DEFAULT 0,
        procure_type TEXT,
        productivity_type TEXT,
        process_group TEXT,
        process_group2 TEXT,
        single_process TEXT,
        use_yn TEXT NOT NULL DEFAULT 'Y',
        reg_date TEXT,
        reg_by TEXT,
        default_daily_capa REAL,
        default_yield_rate REAL,
        default_lot_size REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )
    `);
  }

  // processes: 계획정보(PLAN-02)의 품목×공정 fallback 기본값 3종 — 기존 테이블에 컬럼만 추가.
  const procCols2 = db.prepare("PRAGMA table_info(processes)").all() as { name: string }[];
  const procColNames2 = new Set(procCols2.map((c) => c.name));
  if (!procColNames2.has("default_daily_capa")) {
    db.exec("ALTER TABLE processes ADD COLUMN default_daily_capa REAL");
  }
  if (!procColNames2.has("default_yield_rate")) {
    db.exec("ALTER TABLE processes ADD COLUMN default_yield_rate REAL");
  }
  if (!procColNames2.has("default_lot_size")) {
    db.exec("ALTER TABLE processes ADD COLUMN default_lot_size REAL");
  }

  // equipments: 최초 설계(equipment_id/equipment_name/line_id 3컬럼)를 실제
  // 원본 "설비등록.xlsx" 컬럼 구조로 교체.
  const eqCols = db.prepare("PRAGMA table_info(equipments)").all() as {
    name: string;
  }[];
  if (eqCols.length > 0 && !eqCols.some((c) => c.name === "workplace")) {
    db.exec("DROP TABLE equipments");
    db.exec(`
      CREATE TABLE equipments (
        equipment_id TEXT PRIMARY KEY,
        equipment_name TEXT NOT NULL,
        workplace TEXT,
        equipment_group TEXT,
        personnel REAL,
        wage_rate REAL,
        ton REAL,
        line_id TEXT,
        bf_warehouse TEXT,
        defect_warehouse TEXT,
        defect_pattern TEXT,
        daily_work_minutes REAL,
        work_time_type TEXT,
        uph REAL,
        work_efficiency REAL,
        seq INTEGER NOT NULL DEFAULT 0,
        use_yn TEXT NOT NULL DEFAULT 'Y',
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )
    `);
  }

  // sales_monthly_plan: 월별수주현황분석(MGMT-04)의 금액 기준 목표(plan_amount) —
  // 기존 테이블에 컬럼만 추가한다(기존 EA 기준 plan_qty와 별개, 화면에서 직접 입력).
  const planCols = db.prepare("PRAGMA table_info(sales_monthly_plan)").all() as {
    name: string;
  }[];
  if (planCols.length > 0 && !planCols.some((c) => c.name === "plan_amount")) {
    db.exec("ALTER TABLE sales_monthly_plan ADD COLUMN plan_amount REAL");
  }

  // sales_monthly_plan: 최초 1회만 시드한다(이후는 화면에서 직접 입력/수정) — 2026년
  // 8월 "생산품질_회의보고" 영업 계획표 기준. 1~7월은 당시 보고서의 달성율(%)을 그대로
  // 재현하도록 역산한 계획수량이고, 8월은 보고서의 계획(3,470,000)/계획외(1,113,782)
  // 원본값이다. 이미 데이터가 있으면(사용자가 수정했을 수 있으므로) 건드리지 않는다.
  // production_calendar: "공정마다 근무시간대가 다르다"는 걸 뒤늦게 반영해 회사 공통
  // 1조/2조 잔업 컬럼(실사용 데이터 없었음)을 걷어내고 processes/process_calendar로
  // 옮겼다. DROP COLUMN 미지원 SQLite에서도 안전하게(컬럼이 남아도 코드가 더 이상
  // 참조하지 않으니 무해함) try/catch로 처리한다.
  const calCols = db.prepare("PRAGMA table_info(production_calendar)").all() as {
    name: string;
  }[];
  const calColNames = new Set(calCols.map((c) => c.name));
  for (const col of [
    "shift1_ot_start",
    "shift1_ot_end",
    "shift1_ot_meal_minutes",
    "shift2_ot_start",
    "shift2_ot_end",
    "shift2_ot_meal_minutes",
  ]) {
    if (calColNames.has(col)) {
      try {
        db.exec(`ALTER TABLE production_calendar DROP COLUMN ${col}`);
      } catch {
        // 구버전 SQLite라 DROP COLUMN 미지원 — 컬럼이 남아도 코드에서 안 쓰므로 무해함
      }
    }
  }

  // processes: 생산캘린더(BASE-08) "기본 근무패턴" — 기존 테이블에 컬럼만 추가한다.
  const procCols3 = db.prepare("PRAGMA table_info(processes)").all() as { name: string }[];
  const procColNames3 = new Set(procCols3.map((c) => c.name));
  if (!procColNames3.has("shift1_active_yn")) {
    db.exec("ALTER TABLE processes ADD COLUMN shift1_active_yn TEXT NOT NULL DEFAULT 'Y'");
  }
  if (!procColNames3.has("shift1_start")) {
    db.exec("ALTER TABLE processes ADD COLUMN shift1_start TEXT");
  }
  if (!procColNames3.has("shift1_end")) {
    db.exec("ALTER TABLE processes ADD COLUMN shift1_end TEXT");
  }
  if (!procColNames3.has("shift1_base_minutes")) {
    db.exec("ALTER TABLE processes ADD COLUMN shift1_base_minutes REAL");
  }
  if (!procColNames3.has("shift2_active_yn")) {
    db.exec("ALTER TABLE processes ADD COLUMN shift2_active_yn TEXT NOT NULL DEFAULT 'Y'");
  }
  if (!procColNames3.has("shift2_start")) {
    db.exec("ALTER TABLE processes ADD COLUMN shift2_start TEXT");
  }
  if (!procColNames3.has("shift2_end")) {
    db.exec("ALTER TABLE processes ADD COLUMN shift2_end TEXT");
  }
  if (!procColNames3.has("shift2_base_minutes")) {
    db.exec("ALTER TABLE processes ADD COLUMN shift2_base_minutes REAL");
  }
  if (!procColNames3.has("apply_work_pattern_yn")) {
    db.exec("ALTER TABLE processes ADD COLUMN apply_work_pattern_yn TEXT NOT NULL DEFAULT 'Y'");
  }

  // daily_work_status가 record_key 컬럼 없이 먼저 생성된 기존 DB를 위한 보정 —
  // ALTER TABLE ADD COLUMN은 UNIQUE 제약을 바로 못 붙이므로 컬럼 추가 후 별도 유니크
  // 인덱스로 같은 효과를 낸다.
  const dwsCols = db.prepare("PRAGMA table_info(daily_work_status)").all() as { name: string }[];
  if (!dwsCols.some((c) => c.name === "record_key")) {
    db.exec("ALTER TABLE daily_work_status ADD COLUMN record_key TEXT");
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_work_status_record_key ON daily_work_status(record_key)"
  );

  // dosu_change_status가 inspect_date(검사일자 — 외관검사 일자) 컬럼 없이 먼저 생성된
  // 기존 DB를 위한 보정 — 컬럼 추가 후, 이미 올라와 있던 행은 detail JSON의 "검사일자"
  // ("YYYY.MM.DD" 표기)에서 한 번만 다시 채운다(normalizeOrderDate와 같은 규칙).
  const dcsCols = db.prepare("PRAGMA table_info(dosu_change_status)").all() as { name: string }[];
  if (!dcsCols.some((c) => c.name === "inspect_date")) {
    db.exec("ALTER TABLE dosu_change_status ADD COLUMN inspect_date TEXT");
  }
  db.exec(`
    UPDATE dosu_change_status
    SET inspect_date = CASE
      WHEN json_extract(detail, '$."검사일자"') GLOB '[0-9][0-9][0-9][0-9].[0-9][0-9].[0-9][0-9]*'
        THEN substr(json_extract(detail, '$."검사일자"'), 1, 4) || '-' ||
             substr(json_extract(detail, '$."검사일자"'), 6, 2) || '-' ||
             substr(json_extract(detail, '$."검사일자"'), 9, 2)
      ELSE json_extract(detail, '$."검사일자"')
    END
    WHERE inspect_date IS NULL AND detail IS NOT NULL
      AND json_extract(detail, '$."검사일자"') IS NOT NULL
  `);

  const planCount = (
    db.prepare("SELECT COUNT(*) as c FROM sales_monthly_plan").get() as { c: number }
  ).c;
  if (planCount === 0) {
    const insertPlan = db.prepare(
      "INSERT INTO sales_monthly_plan (month, plan_qty, unplanned_qty) VALUES (?, ?, ?)"
    );
    const seed: [string, number, number][] = [
      ["2026-01", 5632580, 0],
      ["2026-02", 6779781, 0],
      ["2026-03", 7010065, 0],
      ["2026-04", 6495533, 0],
      ["2026-05", 5677660, 0],
      ["2026-06", 5004952, 0],
      ["2026-07", 3734946, 0],
      ["2026-08", 3470000, 1113782],
    ];
    for (const [month, plan, unplanned] of seed) {
      insertPlan.run(month, plan, unplanned);
    }
  }

  // users.process_code(단일 소속공정) -> user_processes(복수) 이관 — 기존 값을
  // 한 번만 백필하고 컬럼은 제거한다. DROP COLUMN 미지원 구버전 SQLite에서도 안전하게
  // (컬럼이 남아도 코드가 더 이상 참조하지 않으니 무해함) try/catch로 처리한다.
  const userCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (userCols.some((c) => c.name === "process_code")) {
    db.exec(`
      INSERT OR IGNORE INTO user_processes (username, process_code)
      SELECT username, process_code FROM users WHERE process_code IS NOT NULL
    `);
    try {
      db.exec("ALTER TABLE users DROP COLUMN process_code");
    } catch {
      // 구버전 SQLite라 DROP COLUMN 미지원 — 컬럼이 남아도 코드에서 안 쓰므로 무해함
    }
  }

  // ppe_items: 고정 3종 최초 1회 시드(이미 있으면 건드리지 않음 — use_yn/이름을 화면에서
  // 바꿀 방법이 아직 없지만, 나중에 생기더라도 재시작마다 덮어쓰지 않도록).
  const ppeItemCount = (db.prepare("SELECT COUNT(*) as c FROM ppe_items").get() as { c: number })
    .c;
  if (ppeItemCount === 0) {
    const insertPpeItem = db.prepare(
      `INSERT INTO ppe_items (item_code, item_name, cycle_type, first_issue_months, repeat_months, seq)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    insertPpeItem.run("PPE-01", "방진복&조끼", "single", null, 6, 1);
    insertPpeItem.run("PPE-02", "방진화&안전화", "single", null, 6, 2);
    insertPpeItem.run("PPE-03", "깔창", "first_then_repeat", 2, 12, 3);
  }

  // shift_time_slots(PSN-07): 최초 1회 참고자료("근무시간.xlsx") 기준 1조/2조 초기
  // 시간표 시드(이미 있으면 건드리지 않음 — 화면에서 사람이 수정한 값을 재시작마다
  // 덮어쓰지 않기 위해). effective_date는 이 프로토타입의 기준일(2026-01-01)로 둔다 —
  // 실제 적용일을 알 수 없어 화면에서 나중에 수정 가능하게만 열어둔다. shift_code는
  // 원래 A조/B조였다가 2026-09-10 사용자 요청으로 1조/2조로 개명(이미 있던 DB는 별도
  // UPDATE로 마이그레이션, 이 시드는 새 DB를 처음 만들 때만 실행됨).
  const shiftSlotCount = (
    db.prepare("SELECT COUNT(*) as c FROM shift_time_slots").get() as { c: number }
  ).c;
  if (shiftSlotCount === 0) {
    const insertShiftSlot = db.prepare(
      `INSERT INTO shift_time_slots (shift_code, segment_name, start_time, end_time, work_minutes, effective_date, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const seedRows: { shift: string; name: string; start: string; end: string }[] = [
      { shift: "1조", name: "조출", start: "05:00", end: "07:00" },
      { shift: "1조", name: "1Q", start: "07:00", end: "09:30" },
      { shift: "1조", name: "휴식", start: "09:30", end: "09:45" },
      { shift: "1조", name: "2Q", start: "09:45", end: "12:30" },
      { shift: "1조", name: "식사1", start: "12:30", end: "13:15" },
      { shift: "1조", name: "3Q", start: "13:15", end: "16:00" },
      { shift: "1조", name: "휴식", start: "16:00", end: "16:10" },
      { shift: "1조", name: "잔업", start: "16:10", end: "18:30" },
      { shift: "2조", name: "1Q", start: "16:00", end: "18:30" },
      { shift: "2조", name: "식사2", start: "18:30", end: "19:15" },
      { shift: "2조", name: "2Q", start: "19:15", end: "22:00" },
      { shift: "2조", name: "휴식2", start: "22:00", end: "22:15" },
      { shift: "2조", name: "3Q", start: "22:15", end: "01:00" },
    ];
    const effectiveDate = "2026-01-01";
    seedRows.forEach((r, i) => {
      const result = computeShiftMinutes(r.start, r.end);
      if (!result) return; // 시드 데이터는 항상 유효해야 정상 — 방어적으로만 건너뜀
      insertShiftSlot.run(r.shift, r.name, r.start, r.end, result.minutes, effectiveDate, (i + 1) * 10);
    });
  }

  // users: 조직구조 분류(소속팀/구분/직급, src/lib/org.ts) — 기존 테이블에 컬럼만 추가.
  if (!userCols.some((c) => c.name === "team")) {
    db.exec("ALTER TABLE users ADD COLUMN team TEXT");
  }
  if (!userCols.some((c) => c.name === "employment_type")) {
    db.exec("ALTER TABLE users ADD COLUMN employment_type TEXT");
  }
  if (!userCols.some((c) => c.name === "position")) {
    db.exec("ALTER TABLE users ADD COLUMN position TEXT");
  }

  // users: 계정관리 화면(SYS-01) 자체가 로그인을 요구하므로, 최초 진입 경로로 관리자
  // 계정 하나를 자동 시드한다(admin/admin1234) — 로그인 후 바로 비밀번호를 바꿔야 한다.
  const userCount = (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
  if (userCount === 0) {
    const { hash, salt } = hashPassword("admin1234");
    db.prepare(
      "INSERT INTO users (username, password_hash, password_salt, display_name, role, use_yn) VALUES (?, ?, ?, ?, 'admin', 'Y')"
    ).run("admin", hash, salt, "관리자");
  }

  // 조회 성능 — 대용량 테이블(daily_work_status 39만 행, items 7만 행, sales_orders
  // 5만 행 등)의 화면 필터가 지금까지 인덱스 없이 매번 풀스캔이었다. LIKE '%...%'
  // 검색은 인덱스를 못 쓰므로 대상에서 뺐고, 등호/범위 조건으로 실제 걸리는 컬럼과
  // json_extract 식(각 *-filters.ts 헬퍼가 만드는 것과 동일한 형태)만 추려서 인덱스를
  // 붙인다. items.detail은 오래된 DB엔 없을 수 있어(scripts/import-items.js 참고)
  // 컬럼 존재를 먼저 확인한다.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_daily_work_status_work_date ON daily_work_status(work_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_daily_work_status_item_code ON daily_work_status(item_code);
    CREATE INDEX IF NOT EXISTS idx_daily_work_status_line ON daily_work_status(json_extract(detail, '$."라인"'));
    CREATE INDEX IF NOT EXISTS idx_daily_work_status_process_name ON daily_work_status(json_extract(detail, '$."공정명"'));
    CREATE INDEX IF NOT EXISTS idx_daily_work_status_model ON daily_work_status(json_extract(detail, '$."형명"'));

    CREATE INDEX IF NOT EXISTS idx_work_order_status_order_date ON work_order_status(order_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_work_order_status_item_code ON work_order_status(item_code);
    CREATE INDEX IF NOT EXISTS idx_work_order_status_line ON work_order_status(json_extract(detail, '$."라인"'));
    CREATE INDEX IF NOT EXISTS idx_work_order_status_status ON work_order_status(json_extract(detail, '$."상태"'));

    CREATE INDEX IF NOT EXISTS idx_defect_type_status_order_date ON defect_type_status(order_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_defect_type_status_item_code ON defect_type_status(item_code);
    CREATE INDEX IF NOT EXISTS idx_defect_type_status_wo_no ON defect_type_status(wo_no);

    CREATE INDEX IF NOT EXISTS idx_dosu_change_status_order_date ON dosu_change_status(order_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_dosu_change_status_item_code ON dosu_change_status(item_code);
    CREATE INDEX IF NOT EXISTS idx_dosu_change_status_wo_no ON dosu_change_status(wo_no);
    CREATE INDEX IF NOT EXISTS idx_dosu_change_status_inspect_date ON dosu_change_status(inspect_date DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_product_shipment_status_ship_date ON product_shipment_status(ship_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_product_shipment_status_item_code ON product_shipment_status(item_code);
    CREATE INDEX IF NOT EXISTS idx_product_shipment_status_customer_code ON product_shipment_status(customer_code);

    CREATE INDEX IF NOT EXISTS idx_purchase_order_status_order_date ON purchase_order_status(order_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_purchase_order_status_item_code ON purchase_order_status(item_code);
    CREATE INDEX IF NOT EXISTS idx_purchase_order_status_po_no ON purchase_order_status(po_no);

    CREATE INDEX IF NOT EXISTS idx_attendance_card_status_work_date ON attendance_card_status(work_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_attendance_card_status_employee_no ON attendance_card_status(employee_no);
    CREATE INDEX IF NOT EXISTS idx_attendance_card_status_org ON attendance_card_status(org);
    CREATE INDEX IF NOT EXISTS idx_attendance_card_status_team ON attendance_card_status(team);

    CREATE INDEX IF NOT EXISTS idx_purchase_receipt_status_receipt_date ON purchase_receipt_status(receipt_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_purchase_receipt_status_item_code ON purchase_receipt_status(item_code);
    CREATE INDEX IF NOT EXISTS idx_purchase_receipt_status_receipt_no ON purchase_receipt_status(receipt_no);

    CREATE INDEX IF NOT EXISTS idx_mold_receipt_status_receipt_date ON mold_receipt_status(receipt_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_mold_receipt_status_item_code ON mold_receipt_status(item_code);
    CREATE INDEX IF NOT EXISTS idx_mold_receipt_status_receipt_no ON mold_receipt_status(receipt_no);

    CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_status_transfer_date ON warehouse_transfer_status(transfer_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_status_item_code ON warehouse_transfer_status(item_code);
    CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_status_transfer_no ON warehouse_transfer_status(transfer_no);
    CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_status_from_warehouse ON warehouse_transfer_status(from_warehouse);
    CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_status_to_warehouse ON warehouse_transfer_status(to_warehouse);

    CREATE INDEX IF NOT EXISTS idx_equipments_equipment_name ON equipments(equipment_name);

    CREATE INDEX IF NOT EXISTS idx_inventory_status_warehouse ON inventory_status(warehouse);
    CREATE INDEX IF NOT EXISTS idx_inventory_status_acct ON inventory_status(json_extract(detail, '$."품목계정"'));
    CREATE INDEX IF NOT EXISTS idx_inventory_status_cat1 ON inventory_status(json_extract(detail, '$."대분류"'));
    CREATE INDEX IF NOT EXISTS idx_inventory_status_cat2 ON inventory_status(json_extract(detail, '$."중분류"'));
    CREATE INDEX IF NOT EXISTS idx_inventory_status_cat3 ON inventory_status(json_extract(detail, '$."소분류"'));

    CREATE INDEX IF NOT EXISTS idx_sales_orders_customer_code ON sales_orders(customer_code);
    CREATE INDEX IF NOT EXISTS idx_sales_orders_item_code ON sales_orders(item_code);
    CREATE INDEX IF NOT EXISTS idx_sales_orders_created_at ON sales_orders(created_at DESC);
  `);

  const itemCols = db.prepare("PRAGMA table_info(items)").all() as { name: string }[];
  if (itemCols.some((c) => c.name === "detail")) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
      CREATE INDEX IF NOT EXISTS idx_items_acct ON items(CAST(json_extract(detail, '$.품목계정') AS TEXT));
      CREATE INDEX IF NOT EXISTS idx_items_cat1 ON items(CAST(json_extract(detail, '$.대분류') AS TEXT));
      CREATE INDEX IF NOT EXISTS idx_items_cat2 ON items(CAST(json_extract(detail, '$.중분류') AS TEXT));
      CREATE INDEX IF NOT EXISTS idx_items_cat3 ON items(CAST(json_extract(detail, '$.소분류') AS TEXT));
      CREATE INDEX IF NOT EXISTS idx_items_cycle ON items(COALESCE(NULLIF(json_extract(detail, '$.주기'), ''), '기타'));
    `);
  } else {
    db.exec("CREATE INDEX IF NOT EXISTS idx_items_category ON items(category)");
  }

  // 인원관리(PSN-01) "일일근태입력" 신설(2026-09-07)을 위해 workers.process_code(BASE-04
  // 공정코드)를 다시 쓴다 — 2026-09-04에 조장 소속공정 접근제어를 work_group 기준으로
  // 전환하며 이 컬럼을 화면에서 뺐고 전원 NULL로 남겨뒀었는데, "공정별근무현황(PSN-04)"의
  // 지원 매트릭스가 성립하려면 조원의 본공정도 지원처와 같은 BASE-04 공정코드 기준이어야
  // 한다. work_group(소속, 사출/인쇄/조립분리 등 9개 굵은 분류)이 BASE-04 공정명과 이름이
  // 정확히 1:1로 겹치는 5개(사출/외관검사/실링/마킹/출하포장)만 자동으로 채우고, "인쇄"
  // (Base 인쇄/착색 인쇄 중 불명)·"조립분리"(조립/분리1~3 중 불명)·"생산지원"·"OEM창고"
  // (BASE-04에 대응 공정 자체가 없음)는 억지로 매핑하지 않고 NULL로 남긴다 — 조장이
  // 작업자등록(BASE-09) 화면에서 개별적으로 채워야 한다. WHERE process_code IS NULL이라
  // 재실행해도 이미 수동으로 채운 값을 덮어쓰지 않는 안전한 1회성 백필이다.
  const workerCols = db.prepare("PRAGMA table_info(workers)").all() as { name: string }[];
  if (workerCols.some((c) => c.name === "process_code")) {
    const unambiguous: [string, string][] = [
      ["사출", "P100"],
      ["외관검사", "P360"],
      ["실링", "P370"],
      ["마킹", "P400"],
      ["출하포장", "P410"],
    ];
    const stmt = db.prepare(
      "UPDATE workers SET process_code = ? WHERE process_code IS NULL AND work_group = ?"
    );
    for (const [workGroup, processCode] of unambiguous) {
      stmt.run(processCode, workGroup);
    }
  }

  // workers: "비즈" 연동 원본값 컬럼 추가(2026-09-08) — 이미 저장된 행이 있어 DROP+CREATE
  // 대신 ALTER TABLE로 붙인다(기존 행은 NULL로 채워짐, PSN-05 초과신청 다운로드에서
  // employee_no/work_group으로 대체 표시).
  if (!workerCols.some((c) => c.name === "biz_employee_no")) {
    db.exec("ALTER TABLE workers ADD COLUMN biz_employee_no TEXT");
  }
  if (!workerCols.some((c) => c.name === "biz_dept")) {
    db.exec("ALTER TABLE workers ADD COLUMN biz_dept TEXT");
  }

  // workers: 교대조(shift_group) 컬럼 추가(2026-09-09) — team("근무조", 급여형태 구분)과
  // 별개인 A조/B조/고정 소속 표시. 기존 행은 이 정보 자체가 없으므로 전부 NULL(미지정)로
  // 시작한다(사용자 명시 요청 — 백필하지 말 것).
  if (!workerCols.some((c) => c.name === "shift_group")) {
    db.exec("ALTER TABLE workers ADD COLUMN shift_group TEXT");
  }

  // work_hours_daily: 휴가(연차/공가) 컬럼 추가(2026-09-07) — 이미 저장된 행이 있어
  // DROP+CREATE 대신 ALTER TABLE로 붙인다(기존 행은 NULL로 채워짐, 정상 동작).
  const workHoursDailyCols = db.prepare("PRAGMA table_info(work_hours_daily)").all() as {
    name: string;
  }[];
  if (
    workHoursDailyCols.length > 0 &&
    !workHoursDailyCols.some((c) => c.name === "leave_type")
  ) {
    db.exec("ALTER TABLE work_hours_daily ADD COLUMN leave_type TEXT");
  }

  // 휴가 드롭다운 "결근"을 "휴무"로 이름 변경(2026-09-08 사용자 요청) — 이미 저장된
  // 값도 함께 바꿔야 화면 드롭다운(work-hours-leave.ts LEAVE_TYPE_OPTIONS)과 어긋나지
  // 않는다. 다시 실행돼도 남은 '결근' 행이 없으면 그냥 0건 UPDATE라 안전하다.
  db.exec("UPDATE work_hours_daily SET leave_type = '휴무' WHERE leave_type = '결근'");

  // 휴가 드롭다운 "반차"를 "전반"/"후반"으로 분리(2026-09-11 사용자 요청, 둘 다 기준시간
  // 4시간은 동일). 기존 저장값은 구분할 근거가 없어 일괄 "전반"으로 옮긴다 — 시간 계산
  // (4시간)은 그대로라 실제 근무시간 값에는 영향이 없고, 표시만 정확한 반차 종류를 다시
  // 지정해줘야 한다. 라벨을 "반차(전반)"/"반차(후반)"으로 먼저 썼다가 곧바로 "전반"/
  // "후반"으로 다시 바꿔서(같은 날) 혹시 그 중간 라벨로 이미 저장된 행이 있어도 같이
  // 옮긴다.
  db.exec(
    "UPDATE work_hours_daily SET leave_type = '전반' WHERE leave_type IN ('반차', '반차(전반)')"
  );
  db.exec("UPDATE work_hours_daily SET leave_type = '후반' WHERE leave_type = '반차(후반)'");
}

// items/processes/equipments 기준정보는 전부 실제 원본 엑셀 임포트로 채운다
// (see scripts/import-items.js, scripts/import-processes.js, scripts/import-equipments.js).

function nowStr(db: DatabaseSync): string {
  const row = db.prepare("SELECT datetime('now','localtime') as t").get() as {
    t: string;
  };
  return row.t;
}

let dbInstance: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  const globalForDb = globalThis as unknown as { __mesDb?: DatabaseSync };
  if (globalForDb.__mesDb) {
    dbInstance = globalForDb.__mesDb;
    return dbInstance;
  }
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
  migrate(db);
  globalForDb.__mesDb = db;
  dbInstance = db;
  return db;
}

let seqCounter = 0;
export function nextId(prefix: string): string {
  seqCounter += 1;
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}-${ts}${seqCounter.toString(36).toUpperCase()}`;
}

export function nextWoNo(db: DatabaseSync): string {
  const row = db
    .prepare("SELECT wo_no FROM work_orders ORDER BY wo_no DESC LIMIT 1")
    .get() as { wo_no: string } | undefined;
  const lastSeq = row ? parseInt(row.wo_no.replace("WO-", ""), 10) : 0;
  const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `WO-${String(next).padStart(4, "0")}`;
}

export function nextSoNo(db: DatabaseSync, orderDate?: string | null): string {
  // SO + 연월일(YYYYMMDD) + 해당 날짜 기준 4자리 순번, 예: SO202608140001.
  // orderDate("YYYY-MM-DD" 또는 "YYYY.MM.DD")를 넘기면 그 날짜(수주일자) 기준으로 발급하고,
  // 없으면 오늘 날짜를 쓴다.
  // 대량등록은 여러 행이 같은 수주번호를 공유하고 "-순번"이 붙어 저장되므로
  // (예: SO202608140001-12), 접미사가 붙은 것까지 포함해 같은 날짜의 최대 4자리
  // 순번을 찾아야 번호가 중복 발급되지 않는다.
  const normalized = orderDate?.replace(/[.\-]/g, "");
  const datePrefix =
    normalized && /^\d{8}$/.test(normalized)
      ? `SO${normalized}`
      : `SO${
          (db.prepare("SELECT strftime('%Y%m%d','now','localtime') as d").get() as { d: string })
            .d
        }`;
  const row = db
    .prepare("SELECT so_no FROM sales_orders WHERE so_no GLOB ? ORDER BY so_no DESC LIMIT 1")
    .get(`${datePrefix}[0-9][0-9][0-9][0-9]*`) as { so_no: string } | undefined;
  const lastSeq = row
    ? parseInt(row.so_no.slice(datePrefix.length, datePrefix.length + 4), 10)
    : 0;
  const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${datePrefix}${String(next).padStart(4, "0")}`;
}

export function nowLocal(db: DatabaseSync): string {
  return nowStr(db);
}
