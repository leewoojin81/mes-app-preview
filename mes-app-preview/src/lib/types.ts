export type ItemCategory = "완제품" | "반제품" | "원자재";

export interface Item {
  item_code: string;
  item_name: string;
  category: ItemCategory;
  spec: string | null;
  unit: string;
  warehouse: string | null;
  safety_stock: number | null;
  /** 원본 엑셀의 "품목군"(detail.품목군) — 목록 검색용 GET(비페이지네이션)만 가볍게 함께 내려준다 */
  item_group?: string | null;
  /**
   * 작업지시등록(PROD-03) 화면이 수주→작업지시 자동 생성 시 스냅샷하는 렌즈 속성 —
   * 목록 검색용 GET(비페이지네이션)만 detail에서 가볍게 함께 내려준다.
   */
  lens_spec?: {
    직경: string | number | null;
    포장방법: string | number | null;
    "캡(실링지)": string | number | null;
    Tone: string | number | null;
    형명: string | number | null;
    BC: string | number | null;
    렌즈구분: string | number | null;
    주기: string | number | null;
    Radius: string | number | null;
    BOM: string | number | null;
    입고창고: string | number | null;
  } | null;
  /** 원본 엑셀 전체 컬럼 (완제품/반제품 62개, 원부자재 38개) — 헤더명 → 값, 원본 컬럼 순서 유지 */
  detail?: Record<string, string | number | null> | null;
}

export interface Equipment {
  equipment_id: string;
  equipment_name: string;
  workplace: string | null;
  equipment_group: string | null;
  personnel: number | null;
  wage_rate: number | null;
  ton: number | null;
  line_id: string | null;
  bf_warehouse: string | null;
  defect_warehouse: string | null;
  defect_pattern: string | null;
  daily_work_minutes: number | null;
  work_time_type: string | null;
  uph: number | null;
  work_efficiency: number | null;
  seq: number;
  use_yn: "Y" | "N";
  created_at: string;
}

// 인원관리(PSN-01) "작업자등록" — 인사관리(급여·평가 등)가 아니라 생산현장 실적 로그에
// 이름이 찍히는 작업자의 최소 운영 정보(소속 라인·담당 공정·직책·연락처 등)만 관리한다.
export interface Worker {
  employee_no: string;
  erp_code: string | null;
  employee_qr: string | null;
  worker_name: string;
  contractor: string | null;
  process_code: string | null;
  work_group: string | null;
  /** "비즈" 근태 시스템 원본 사번(13자리) — 비즈 연동으로 등록한 경우만 값이 있다. */
  biz_employee_no: string | null;
  /** "비즈" 근태 시스템 원본 부서 — 우리 work_group과 이름이 달라 그대로 보존한다. */
  biz_dept: string | null;
  duty: string | null;
  team: string | null;
  /** 교대조(A조/B조/고정) — team("근무조", 급여형태 구분)과 별개인 소속 표시. 자동
   *  순환계산 없는 고정값이며, 기존 작업자는 NULL(미지정)로 시작한다. */
  shift_group: string | null;
  phone: string | null;
  hire_date: string | null;
  bus_route: string | null;
  bus_stop: string | null;
  uniform_size: string | null;
  shoe_size: string | null;
  status: string | null;
  resign_date: string | null;
  resign_reason: string | null;
  remark: string | null;
  seq: number;
  use_yn: "Y" | "N";
  created_at: string;
}

// "기준정보 변경이력"(BASE-10) — 품목/자재/BOM/설비/거래처/창고/작업자 등 모든 기준정보의
// 필드 변경을 entity_type(대상유형)+entity_id(대상ID)로 함께 쌓는 통합 이력(지금은
// entity_type="작업자"만 실제로 로깅됨, master-data-history.ts 참고). entity_name은
// 조회 화면에서 entity_type에 맞는 마스터(작업자면 workers 등)를 조인해 참고용으로만
// 붙여주는 값(이력 테이블 자체엔 없음).
export interface MasterDataChangeHistoryRow {
  id: number;
  entity_type: string;
  entity_id: string;
  entity_name: string | null;
  field: string;
  field_label: string;
  old_value: string | null;
  new_value: string | null;
  change_date: string;
  changed_by: string | null;
  changed_by_name: string | null;
  created_at: string;
}

// 인원관리(PSN-03) "보호구지급관리" 보호구품목 마스터(고정 3종, src/lib/db.ts에서 시드).
export interface PpeItem {
  item_code: string;
  item_name: string;
  cycle_type: "single" | "first_then_repeat";
  first_issue_months: number | null;
  repeat_months: number;
  seq: number;
  use_yn: "Y" | "N";
}

// 인원관리(PSN-03) 지급이력 1건.
export interface PpeIssuance {
  id: number;
  employee_no: string;
  item_code: string;
  issue_date: string;
  issue_seq: number;
  next_due_date: string | null;
  received_yn: "Y" | "N";
  note: string | null;
  created_at: string;
}

// 인원관리(PSN-03) 지급현황 화면 — 작업자×보호구품목 조합 하나(다음지급예정일 계산 결과
// 포함, 지급이력이 아직 없으면 last_issue_date/issue_seq는 null이고 next_due_date만
// 있을 수 있다(깔창의 최초지급 예정일) 또는 next_due_date도 null(방진복/방진화 미지급).
export interface PpeStatusCell {
  employee_no: string;
  worker_name: string;
  process_code: string | null;
  use_yn: "Y" | "N";
  item_code: string;
  last_issue_date: string | null;
  issue_seq: number | null;
  next_due_date: string | null;
  received_yn: "Y" | "N" | null;
}

// 시스템관리(SYS-01) "사용자계정관리" — 로그인 계정. 목록/응답에는 비밀번호 해시를
// 절대 내려주지 않는다(src/app/api/users 참고).
export interface AppUser {
  username: string;
  display_name: string | null;
  process_codes: string[];
  role: "leader" | "admin";
  use_yn: "Y" | "N";
  team: string | null;
  employment_type: string | null;
  position: string | null;
  created_at: string;
  override_count: number;
}

export interface ScreenPermissionGroup {
  label: string;
  screens: { code: string; label: string; allowed: boolean; isDefault: boolean }[];
}

// 인원관리(PSN-01) "일일근태입력" — 날짜 하나 + workers 전체를 합쳐 화면에 내려주는 행.
// "일일근태입력.xlsx" 양식 그대로: 자공정 7항목(정상/잔업/조출/중교/지각/조퇴/외출)을
// 입력하면 total_hours = 정상+잔업+조출+중교-지각-조퇴-외출+지원시간 을 서버가 계산한다.
// work_group/duty/team/contractor 등은 저장분과 무관하게 매 조회마다 workers 테이블
// 최신값을 그대로 보여주는 읽기전용 표시다(엑셀의 "공정(작업자등록 기준 자동표시)").
export interface WorkHoursRow {
  employee_no: string;
  erp_code: string | null;
  employee_qr: string | null;
  worker_name: string;
  contractor: string | null;
  work_group: string | null;
  team: string | null;
  /** 교대조(A조/B조/고정) — workers.shift_group을 매 조회마다 그대로 보여주는 읽기전용
   *  표시(work_group/duty/team과 동일한 방식). 개별 변경은 /api/workers/shift-group로
   *  즉시 반영되며, 이 화면의 "저장" 버튼(work_hours_daily 전용)과는 무관하다. */
  shift_group: string | null;
  duty: string | null;
  /** 휴가(연차/공가) — 근무시간 합계와 무관한 별도 기록용 표시(없으면 null). */
  leave_type: string | null;
  /** 이 날짜/작업자로 저장된 work_hours_daily 행이 있는지 — 화면에서 "저장됨"/"미저장"
   *  구분 표시에 쓴다(2026-09-08 사용자 요청). 없으면 정상 외 항목은 전부 기본값(0)이다. */
  has_record: boolean;
  normal_hours: number;
  overtime_hours: number;
  early_start_hours: number;
  lunch_shift_hours: number;
  late_hours: number;
  early_leave_hours: number;
  outing_hours: number;
  total_hours: number;
  support_work_group: string | null;
  support_hours: number;
}
export interface WorkHoursResponse {
  date: string;
  rows: WorkHoursRow[];
  /** 이 날짜로 마지막 저장이 있었던 시각(없으면 null) — 잘못 입력해도 같은 날짜를 다시
   * 열어 고치고 저장하면 그대로 덮어써진다는 걸 화면에서 확인할 수 있게 내려준다. */
  lastSavedAt: string | null;
}

// 인원관리(PSN-07) "근무시간정보" — 조(1조/2조)별 근무시간표 구간 1행. 근태대사(PSN-06)가
// 이후 지각/조출/잔업 판정 기준으로 참조할 예정(2026-09-09, 다음 단계에서 연동)이라 시작~
// 종료 시각과 근로시간(분)을 명확히 구조화해 둔다.
export interface ShiftTimeSlot {
  id: number;
  shift_code: string;
  segment_name: string;
  start_time: string;
  end_time: string;
  /** 종료시각이 시작시각보다 이른 구간(다음날로 넘어감, 예: 2조 3Q 22:15~다음날 01:00) — 서버가 계산해 내려주는 표시용 값. */
  crosses_midnight: boolean;
  work_minutes: number;
  effective_date: string;
  seq: number;
  created_at: string;
  updated_at: string;
}

// 계획정보(PLAN-02) "공정별 월 CAPA 및 근무계획" 라인 1행 — src/lib/production-plan-lines.ts의
// computeLineCapaPlan이 만들어 내려준다.
export interface LineCapaRow {
  key: string;
  label: string;
  isIndirect: boolean;
  headcount: number;
  hoursPerDay: number;
  workDays: number;
  dailyCapa: number | null;
  monthlyCapa: number | null;
  uph: number | null;
  remark: string | null;
  defaultRemark: string | null;
}
export interface LineCapaResult {
  yearMonth: string;
  rows: LineCapaRow[];
  totals: {
    headcount: number;
    dailyCapa: number | null;
    monthlyCapa: number | null;
    uph: number | null;
  };
}

// 경영정보 "공정별생산현황(MGMT-05, 매일 아침 회의용)" 라인 1행 —
// src/lib/production-status.ts의 computeProductionStatus가 만들어 내려준다.
export interface ProductionStatusRow {
  key: string;
  label: string;
  isMold: boolean;
  headcount: number;
  monthlyTarget: number | null;
  dailyTarget: number | null;
  yesterdayQty: number;
  mtdQty: number;
  wip: number;
  shortage: number | null;
  achievementRate: number | null;
  progressRate: number | null;
  progressGap: number | null;
  cumulativeShortage: number | null;
  yesterdayUph: number | null;
  mtdUph: number | null;
  prevMonthUph: number | null;
}
export interface ProductionStatusResult {
  asOfDate: string;
  yesterday: string;
  yearMonth: string;
  totalWorkDays: number;
  doneWorkDays: number;
  remainingWorkDays: number;
  overallProgressRate: number | null;
  prevYearMonth: string;
  rows: ProductionStatusRow[];
}

// MGMT-05 표 하단 그래프 — src/lib/production-status.ts의 computeProductionTrend가 만들어 내려준다.
export interface ProductionTrendPoint {
  label: string;
  qty: number;
}
export interface ProductionTrendResult {
  lineKey: string;
  label: string;
  points: ProductionTrendPoint[];
  average: number;
}

// 인원관리(PSN-04) "공정별근무현황" — 조회기간 내 공정(BASE-04 process_name)별 연인원(person-day) 집계 1행.
export interface ProcessWorkSummaryRow {
  process_name: string;
  normal_person_days: number;
  support_in_person_days: number;
  support_out_person_days: number;
  support_in_hours: number;
  support_out_hours: number;
}

// PSN-04 지원 매트릭스 — (본공정 -> 지원공정) 조합 1행, 둘 다 BASE-04 process_name 기준.
export interface SupportMatrixCell {
  from_process_name: string;
  to_process_name: string;
  person_days: number;
  total_hours: number;
}
export interface WorkHoursSummaryResponse {
  dateFrom: string;
  dateTo: string;
  byProcess: ProcessWorkSummaryRow[];
  matrix: SupportMatrixCell[];
}

export interface Process {
  process_code: string;
  process_name: string;
  seq: number;
  procure_type: string | null;
  productivity_type: string | null;
  process_group: string | null;
  process_group2: string | null;
  single_process: string | null;
  use_yn: "Y" | "N";
  reg_date: string | null;
  reg_by: string | null;
  /** 계획정보(PLAN-02)에서 품목×공정별 값이 없을 때 쓰는 기본 일CAPA/생산수율(%)/Lot Size */
  default_daily_capa: number | null;
  default_yield_rate: number | null;
  default_lot_size: number | null;
  /**
   * 생산캘린더(BASE-08) "기본 근무패턴" — 이 공정의 표준 1조/2조 시작·종료시각과
   * 기본작업시간(식사 제외 순작업분). base_minutes가 비어 있으면 화면에서 480분(레거시
   * 기본값)으로 취급한다.
   */
  shift1_active_yn: "Y" | "N";
  shift1_start: string | null;
  shift1_end: string | null;
  shift1_base_minutes: number | null;
  shift2_active_yn: "Y" | "N";
  shift2_start: string | null;
  shift2_end: string | null;
  shift2_base_minutes: number | null;
  /**
   * "공정 사용/중단"(use_yn)과 별개 — 이 공정을 생산캘린더(BASE-08) 근무시간 계산
   * 대상에 포함할지 여부. N이면 실적등록 등에는 계속 쓰이되 캘린더 계산에서만 빠진다.
   */
  apply_work_pattern_yn: "Y" | "N";
  created_at: string;
}

// 계획정보(PLAN-02) — 선택한 품목 기준, 공정 하나당 한 행. daily_capa/yield_rate/lot_size는
// 품목×공정 개별 입력값(없으면 null)이고, default_* 는 공정등록(BASE-04)의 기본값이다.
export interface ItemProcessRoutingRow {
  process_code: string;
  process_name: string;
  seq: number;
  daily_capa: number | null;
  yield_rate: number | null;
  lot_size: number | null;
  default_daily_capa: number | null;
  default_yield_rate: number | null;
  default_lot_size: number | null;
}

export interface Customer {
  customer_code: string;
  customer_name: string;
  customer_type: string | null;
  biz_reg_no: string | null;
  ceo_name: string | null;
  zip_code: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  biz_type: string | null;
  biz_item: string | null;
  manager_name: string | null;
  settle_customer_code: string | null;
  settle_customer_name: string | null;
  trade_start_date: string | null;
  trade_end_date: string | null;
  category_large: string | null;
  category_mid: string | null;
  category_small: string | null;
  bank_name: string | null;
  bank_account: string | null;
  account_holder: string | null;
  website: string | null;
  is_purchase: "Y" | "N";
  is_outsourcing: "Y" | "N";
  is_sales: "Y" | "N";
  country: string | null;
  seq: number;
  use_yn: "Y" | "N";
  created_at: string;
}

export interface Warehouse {
  warehouse_code: string;
  warehouse_name: string;
  workplace: string | null;
  procure_type: string | null;
  warehouse_type: string | null;
  seq: number;
  use_yn: "Y" | "N";
  created_at: string;
}

export type CalendarDayType = "평일" | "휴일" | "특근";

// 생산캘린더(BASE-08) "회사 공통" 레이어 — 날짜별 근무구분/근무여부/비고. cal_date 행이
// 없는 날짜는 화면에서 "미등록"으로 표시된다(기본값 없음). 공정별 근무시간은 여기 없고
// processes(공정 표준 패턴) + process_calendar(날짜×공정 예외)에서 계산한다.
export interface ProductionCalendarDay {
  cal_date: string;
  day_type: CalendarDayType;
  work_yn: "Y" | "N";
  note: string | null;
  updated_at: string;
}

// 조(1조/2조) 근무시간 — process-calendar.ts가 공정 표준 패턴 + 회사 근무구분 + 예외를
// 조합해 계산한 결과. active_yn=null은 "회사 캘린더 자체가 미등록"이라 계산 불가 상태.
export interface ShiftInfo {
  active_yn: "Y" | "N" | null;
  base_minutes: number;
  /** 공정의 표준 시작/종료시각(참고용 — 계산에는 base_minutes를 그대로 쓴다) */
  start: string | null;
  end: string | null;
  ot_start: string | null;
  ot_end: string | null;
  ot_meal_minutes: number | null;
  ot_minutes: number;
  total_minutes: number | null;
}

// 생산캘린더(BASE-08) "날짜 × 공정" 계산 결과 — 공정 선택 후 월별 캘린더에 쓰인다.
// registered=false면 회사 캘린더 자체가 미등록(company_day_type=null), overridden=true면
// 이 날짜·공정에 개별 예외(process_calendar)가 있다는 뜻이다.
export interface ProcessCalendarDay {
  cal_date: string;
  process_code: string;
  company_day_type: CalendarDayType | null;
  company_note: string | null;
  registered: boolean;
  overridden: boolean;
  note: string | null;
  /** 원본 오버라이드 값(Y/N/null=기본값 사용) — 수정 폼에서 "기본값 사용" 상태를 구분하는 데 쓴다 */
  shift1_active_override: "Y" | "N" | null;
  shift2_active_override: "Y" | "N" | null;
  shift1: ShiftInfo;
  shift2: ShiftInfo;
  total_minutes: number;
}

export type SalesOrderStatus = "수주" | "Packing" | "출고" | "완료" | "중단";

export interface SalesOrder {
  so_no: string;
  customer_code: string;
  customer_name: string;
  item_code: string;
  item_name: string;
  order_qty: number;
  unit_price: number | null;
  due_date: string | null;
  status: SalesOrderStatus;
  created_at: string;
  confirmed_at: string | null;
  /** 원본 "수주현황" 엑셀 전체 컬럼(헤더명 → 값) — 수동 등록분은 없음(null) */
  detail?: Record<string, string | number | null> | null;
}

export interface SalesOrderListResponse {
  rows: SalesOrder[];
  total: number;
  page: number;
  pageSize: number;
  /** 검색/필터 조건이 적용된 전체 건에 대한 수량 컬럼 합계(현재 페이지가 아니라 전체 기준) */
  totals: Record<string, number>;
}

export type WorkOrderStatus = "대기" | "발행" | "진행" | "완료";

export interface WorkOrder {
  wo_no: string;
  item_code: string;
  item_name: string;
  line_id: string;
  order_qty: number;
  produced_qty: number;
  status: WorkOrderStatus;
  due_date: string | null;
  created_at: string;
  issued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  /** 이 작업지시를 생성한 원본 수주 — 작업지시등록(PROD-03)에서 수주 선택으로 만든 건만 있음 */
  so_no?: string | null;
  customer_name?: string | null;
  /** so_no로 생성된 wo가 아니면 null. 생산 실적 입력 후 배정된 Lot(들), 콤마 구분 */
  lot_no?: string | null;
  /**
   * 작업지시등록 화면 전용 항목(순서/순번/긴급/Release사용/의뢰번호/비고) 및 생성 시점
   * 품목 마스터에서 스냅샷한 렌즈 속성(품목군/직경/포장방법/캡실링지/Tone/형명/BC/
   * 렌즈구분/주기/Radius/BOM/입고창고) — 헤더명 → 값.
   */
  detail?: Record<string, string | number | null> | null;
}

export type LotType = "원자재" | "생산";

export interface Lot {
  lot_no: string;
  wo_no: string | null;
  item_code: string;
  qty: number;
  status: string;
  lot_type: LotType;
  created_at: string;
}

export interface ProductionResult {
  result_id: string;
  wo_no: string;
  lot_no: string;
  equipment_id: string | null;
  equipment_name: string | null;
  qty: number;
  reg_time: string;
}

export interface Defect {
  defect_id: string;
  wo_no: string;
  lot_no: string | null;
  defect_type: string;
  qty: number;
  reg_time: string;
}

export interface MaterialInput {
  input_id: string;
  wo_no: string;
  material_lot_no: string;
  item_name: string;
  qty: number;
  reg_time: string;
}

export interface MaterialLot {
  lot_no: string;
  item_code: string;
  item_name: string;
  unit: string;
  available_qty: number;
}

// BOM관리(BASE-03) "신규 모델 추가" 이력 — 기존에 없던 완제품이 새로 등록된 건만 쌓인다.
export interface BomModelLog {
  id: number;
  item_code: string;
  item_name: string;
  source: "직접등록" | "엑셀업로드";
  child_count: number;
  created_at: string;
}

export interface BomRow {
  child_item_code: string;
  item_name: string;
  category: ItemCategory;
  spec: string | null;
  unit: string;
  qty_per: number;
  children: BomRow[];
}

export interface ItemListResponse {
  rows: Item[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InventoryRow {
  inventory_id: string;
  item_code: string;
  item_name: string;
  category: ItemCategory;
  unit: string;
  lot_no: string;
  location: string;
  qty: number;
  status: string;
  updated_at: string;
}

export type ActivityEvent =
  | { type: "실적"; time: string; label: string }
  | { type: "불량"; time: string; label: string }
  | { type: "자재투입"; time: string; label: string };

// 현재고현황(INV-02)/공정재공현황(INV-03) — 원본 ERP 엑셀 업로드 스냅샷.
// 업로드할 때마다 기존 행을 전부 지우고 새로 채우므로 uploaded_at이 곧 "기준 시점"이다.
export interface InventoryStatusRow {
  id: number;
  item_code: string | null;
  lot_no: string | null;
  warehouse: string | null;
  stock_qty: number | null;
  uploaded_at: string;
  /** 원본 엑셀 전체 컬럼(헤더명 → 값) */
  detail: Record<string, string | number | null> | null;
}

export interface InventoryStatusListResponse {
  rows: InventoryStatusRow[];
  total: number;
  page: number;
  pageSize: number;
  uploadedAt: string | null;
  /** 검색 필터가 적용된 전체 건에 대한 수량 컬럼 합계(현재 페이지가 아니라 전체 기준) */
  totals: Record<string, number>;
}

// 공정표발행(PROD-04) 재고 확인 팝업 — 계획수량 기준 반제품(품목군 "착색") 소요량 vs
// 현재고현황(INV-02) LOT별 재고.
export interface StockCheckRow {
  child_item_code: string;
  unit: string;
  qty_per: number;
  required_qty: number;
  /** LOT별 수량의 합계 */
  stock_qty: number;
  shortage_qty: number;
  sufficient: boolean;
  lots: {
    /** 현재고현황(INV-02, inventory_status) 행 id — 저장 시 실제 재고 차감 대상 지정용 */
    id: number;
    lot_no: string;
    warehouse: string | null;
    qty: number;
    /** "자동" — 일일작업현황(PROD-10)에서 해당 LOT가 공정코드 P210 "자동Base" 설비로
     * 실적이 잡혀 있으면. 아니면 "-". */
    division: string;
  }[];
}

export interface ProcessWipRow {
  id: number;
  item_code: string | null;
  wo_no: string | null;
  lot_no: string | null;
  so_no: string | null;
  uploaded_at: string;
  /** 원본 엑셀 전체 컬럼(헤더명 → 값) */
  detail: Record<string, string | number | null> | null;
}

export interface ProcessWipListResponse {
  rows: ProcessWipRow[];
  total: number;
  page: number;
  pageSize: number;
  uploadedAt: string | null;
  /** 검색 필터가 적용된 전체 건에 대한 공정별 재공수량 합계(현재 페이지가 아니라 전체 기준) */
  totals: Record<string, number>;
}

// 영업관리 "제품출고등록(SALES-03)" — ERP 출고 실적 리포트 엑셀 업로드(기간별 누적).
export interface ProductShipmentRow {
  id: number;
  shipment_no: string | null;
  /** "YYYY-MM-DD"로 정규화된 출고일자(필터/정렬용) */
  ship_date: string | null;
  item_code: string | null;
  customer_code: string | null;
  so_no: string | null;
  uploaded_at: string;
  /** 원본 엑셀 전체 컬럼(헤더명 → 값) */
  detail: Record<string, string | number | null> | null;
}

export interface ProductShipmentListResponse {
  rows: ProductShipmentRow[];
  total: number;
  page: number;
  pageSize: number;
  uploadedAt: string | null;
  /** 검색/필터 조건이 적용된 전체 건에 대한 수량/금액 합계(현재 페이지가 아니라 전체 기준) */
  totals: Record<string, number>;
}

// 구매관리 "구매발주등록(PUR-01)" — ERP 발주 리포트(d_phmr210) 엑셀 업로드(기간별 누적).
export interface PurchaseOrderRow {
  id: number;
  po_no: string | null;
  /** "YYYY-MM-DD"로 정규화된 발주일자(필터/정렬용) */
  order_date: string | null;
  item_code: string | null;
  customer_code: string | null;
  uploaded_at: string;
  /** 원본 엑셀 전체 컬럼(헤더명 → 값) */
  detail: Record<string, string | number | null> | null;
}

export interface PurchaseOrderListResponse {
  rows: PurchaseOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  uploadedAt: string | null;
  /** 검색/필터 조건이 적용된 전체 건에 대한 수량/금액 합계(현재 페이지가 아니라 전체 기준) */
  totals: Record<string, number>;
}

// 구매관리 "구매입고등록(PUR-02)" — ERP 입고 실적 리포트(d_phmr320) 엑셀 업로드(기간별 누적).
export interface PurchaseReceiptRow {
  id: number;
  receipt_no: string | null;
  /** "YYYY-MM-DD"로 정규화된 입고일(필터/정렬용) */
  receipt_date: string | null;
  item_code: string | null;
  customer_code: string | null;
  lot_no: string | null;
  uploaded_at: string;
  /** 원본 엑셀 전체 컬럼(헤더명 → 값) */
  detail: Record<string, string | number | null> | null;
}

export interface PurchaseReceiptListResponse {
  rows: PurchaseReceiptRow[];
  total: number;
  page: number;
  pageSize: number;
  uploadedAt: string | null;
  /** 검색/필터 조건이 적용된 전체 건에 대한 수량/금액 합계(현재 페이지가 아니라 전체 기준) */
  totals: Record<string, number>;
}

// 재고관리 "MOLD입고현황(INV-04)" — ERP 몰드 입고 리포트 엑셀 업로드(기간별 누적).
export interface MoldReceiptRow {
  id: number;
  receipt_no: string | null;
  /** "YYYY-MM-DD"로 정규화된 입고일(필터/정렬용) */
  receipt_date: string | null;
  item_code: string | null;
  warehouse: string | null;
  lot_no: string | null;
  uploaded_at: string;
  /** 원본 엑셀 전체 컬럼(헤더명 → 값) */
  detail: Record<string, string | number | null> | null;
}

export interface MoldReceiptListResponse {
  rows: MoldReceiptRow[];
  total: number;
  page: number;
  pageSize: number;
  uploadedAt: string | null;
  /** 검색/필터 조건이 적용된 전체 건에 대한 입고량 합계(현재 페이지가 아니라 전체 기준) */
  totals: Record<string, number>;
}

// 재고관리 "창고이동현황(INV-05)" — ERP 창고간 이동 리포트 엑셀 업로드(기간별 누적).
export interface WarehouseTransferRow {
  id: number;
  transfer_no: string | null;
  /** "YYYY-MM-DD"로 정규화된 이동일자(필터/정렬용) */
  transfer_date: string | null;
  item_code: string | null;
  from_warehouse: string | null;
  to_warehouse: string | null;
  lot_no: string | null;
  uploaded_at: string;
  /** 원본 엑셀 전체 컬럼(헤더명 → 값) */
  detail: Record<string, string | number | null> | null;
}

export interface WarehouseTransferListResponse {
  rows: WarehouseTransferRow[];
  total: number;
  page: number;
  pageSize: number;
  uploadedAt: string | null;
  /** 검색/필터 조건이 적용된 전체 건에 대한 출고/입고 수량 합계(현재 페이지가 아니라 전체 기준) */
  totals: Record<string, number>;
}

// 생산관리 "작업지시현황(PROD-05)" — ERP 작업지시 실적 리포트 엑셀 업로드(기간별 누적).
export interface WorkOrderStatusRow {
  id: number;
  wo_no: string | null;
  /** "YYYY-MM-DD"로 정규화된 지시일자(필터/정렬용) */
  order_date: string | null;
  item_code: string | null;
  lot_no: string | null;
  so_no: string | null;
  uploaded_at: string;
  /** 원본 엑셀 전체 컬럼(헤더명 → 값) */
  detail: Record<string, string | number | null> | null;
}

export interface WorkOrderStatusListResponse {
  rows: WorkOrderStatusRow[];
  total: number;
  page: number;
  pageSize: number;
  uploadedAt: string | null;
  /** 검색/필터 조건이 적용된 전체 건에 대한 수량 합계(현재 페이지가 아니라 전체 기준) */
  totals: Record<string, number>;
}

// 생산관리 "불량종합현황(PROD-07)" — ERP 불량 유형별 리포트 엑셀 업로드(기간별 누적).
export interface DefectTypeStatusRow {
  id: number;
  /** "YYYY-MM-DD"로 정규화된 생산일자(필터/정렬용) */
  order_date: string | null;
  item_code: string | null;
  wo_no: string | null;
  lot_no: string | null;
  uploaded_at: string;
  /** 원본 엑셀 전체 컬럼(헤더명 → 값) */
  detail: Record<string, string | number | null> | null;
}

export interface DefectTypeStatusListResponse {
  rows: DefectTypeStatusRow[];
  total: number;
  page: number;
  pageSize: number;
  uploadedAt: string | null;
  /** 검색/필터 조건이 적용된 전체 건에 대한 수량 합계(현재 페이지가 아니라 전체 기준) */
  totals: Record<string, number>;
}

// 생산관리 "도수변경등록(PROD-06)" — ERP 조립 실적 리포트 엑셀 업로드(기간별 누적).
export interface DosuChangeRow {
  id: number;
  /** "YYYY-MM-DD"로 정규화된 지시일자(필터/정렬용) */
  order_date: string | null;
  item_code: string | null;
  wo_no: string | null;
  lot_no: string | null;
  uploaded_at: string;
  /** 원본 엑셀 전체 컬럼(헤더명 → 값) */
  detail: Record<string, string | number | null> | null;
}

export interface DosuChangeListResponse {
  rows: DosuChangeRow[];
  total: number;
  page: number;
  pageSize: number;
  uploadedAt: string | null;
  /** 검색/필터 조건이 적용된 전체 건에 대한 수량 합계(현재 페이지가 아니라 전체 기준) */
  totals: Record<string, number>;
}

// 품질관리 "도수변경현황(QC-01)" — 도수변경등록(dosu_change_status) 데이터를 일별
// 변경건수로 집계한 추이. 별도 업로드 없이 기존 데이터를 재집계만 한다.
export interface DosuTrendResponse {
  /** rate: 그 구간(일/주/월) 전체 조립실적 대비 변경건수 비율(%, 소수 첫째 자리) */
  trend: { date: string; count: number; rate: number }[];
  /** 조회 구간 전체 변경건수 합계 */
  total: number;
  /** date 필드의 단위 — day: YYYY-MM-DD, week: 그 주 월요일 YYYY-MM-DD, month: YYYY-MM */
  granularity: "day" | "week" | "month";
}

// 품질관리 "도수변경현황(QC-01)" 파레토 분석 — 몰드(조립투입품목)/형명 그룹별
// 변경건수 내림차순 랭킹.
export interface DosuParetoRow {
  group: string;
  /** 이 그룹의 전체 조립실적건수(작업지시번호 기준 중복 제거, 변경 여부 무관) */
  total: number;
  /** 이 그룹의 변경건수(작업지시번호 기준 중복 제거) */
  count: number;
  /** 이 그룹 자체 전체 조립실적 대비 변경율(%, 소수 첫째 자리) */
  rate: number;
  /** 변경건수 내림차순 정렬 기준 누적 변경건수 */
  cumCount: number;
  /** 전체 변경건수 대비 누적 비율(%, 소수 첫째 자리) */
  cumRate: number;
}

export interface DosuParetoResponse {
  dim: "mold" | "model";
  rows: DosuParetoRow[];
  /** 조회 조건 전체 변경건수 합계(누적비율 100% 기준) */
  grandTotal: number;
}

// 품질관리 "형명별/몰드별/원료LOT별 B.C 분포 분석(QC-02)" — 일일작업현황(daily_work_status)
// 원본 데이터를 재집계한다(별도 업로드 없음). 형명+몰드코드 조합 하나가 그룹 하나, 그
// 안에서 rowKey(요약 모드는 "YYYY-MM" 작업월, 상세 모드는 HEMA No/원료 LOT)별로 행이
// 나뉜다. 몰드코드는 daily_work_status엔 없는 값이라 dosu_change_status의 조립투입품목
// (조립투입품목명에 "몰드"가 들어간 행, 예: "3860D")을 item_code로 매핑해서 붙인다 —
// 매핑이 없는 품목코드는 몰드코드를 알 수 없어 제외된다.
// (참고: LOT No 기준 행 나누기도 한때 토글로 시도했었는데, LOT No만 있고 HEMA No가 비어
// 있는 행 중 B.C가 0으로 기록된 데이터 결함이 섞여 있어 사용자 요청으로 제거함, 2026-08-24.)
export interface BcDistributionRow {
  rowKey: string;
  /** 이 행의 유효 샘플 수(B.C1/2/3 중 null이 아닌 값 합) */
  sampleCount: number;
  /** bins와 같은 길이 — 각 구간에 속한 샘플의 비율(%, 소수 첫째 자리) */
  values: number[];
  /** bins와 같은 길이 — 각 구간에 속한 샘플 수(원시 카운트) */
  counts: number[];
  /** 표시 범위(규격 B.C ± 0.25) 하한보다 낮은 실측값이 있어 첫 칸에 몰아 넣었으면 true */
  lowerOverflow: boolean;
  /** 표시 범위 상한보다 높은 실측값이 있어 마지막 칸에 몰아 넣었으면 true */
  upperOverflow: boolean;
}
export interface BcDistributionGroup {
  model: string;
  /** 몰드코드(dosu_change_status 조립투입품목 기준, 예: "3860D"~"5872D") */
  mold: string;
  /** 품목B.C(규격값) — 이 몰드코드로 매핑된 품목 중 처음 만난 값(품목마다 다를 수 있음, 없으면 null) */
  specBc: number | null;
  /** 0.05 간격 구간의 하한값 목록(그룹의 실측/규격값 범위 기준, 양옆 1칸 여유 포함) */
  bins: number[];
  rows: BcDistributionRow[];
}
export interface BcDistributionResponse {
  groups: BcDistributionGroup[];
}
export interface BcDistributionFiltersResponse {
  models: string[];
  /** 몰드코드 목록(예: "3860D"~"5872D") */
  molds: string[];
}

// 품질관리 "직경 분포 분석(QC-03)" — B.C 분포 분석(QC-02)과 완전히 같은 구조를
// 직경1/직경2/직경3(및 규격 품목직경)에 적용한 것. rowKey는 mode에 따라 "전체"(요약)/
// "YYYY-MM"(월별)/HEMA No(상세) 중 하나다.
export interface DiameterDistributionRow {
  rowKey: string;
  /** 이 행의 유효 샘플 수(직경1/2/3 중 null이 아닌 값 합) */
  sampleCount: number;
  /** bins와 같은 길이 — 각 구간에 속한 샘플의 비율(%, 소수 첫째 자리) */
  values: number[];
  /** bins와 같은 길이 — 각 구간에 속한 샘플 수(원시 카운트) */
  counts: number[];
  /** 표시 범위(규격 직경 ± 0.25) 하한보다 낮은 실측값이 있어 첫 칸에 몰아 넣었으면 true */
  lowerOverflow: boolean;
  /** 표시 범위 상한보다 높은 실측값이 있어 마지막 칸에 몰아 넣었으면 true */
  upperOverflow: boolean;
}
export interface DiameterDistributionGroup {
  model: string;
  /** 몰드코드(dosu_change_status 조립투입품목 기준) */
  mold: string;
  /** 품목직경(규격값) — 이 몰드코드로 매핑된 품목 중 처음 만난 값(품목마다 다를 수 있음, 없으면 null) */
  specDia: number | null;
  /** 0.05 간격 구간의 하한값 목록(그룹의 실측/규격값 범위 기준, 양옆 1칸 여유 포함) */
  bins: number[];
  rows: DiameterDistributionRow[];
}
export interface DiameterDistributionResponse {
  groups: DiameterDistributionGroup[];
}
export interface DiameterDistributionFiltersResponse {
  models: string[];
  /** 몰드코드 목록 */
  molds: string[];
}

// 품질관리 "도수 분포 분석(QC-04)" — B.C 분포 분석(QC-02)/직경 분포 분석(QC-03)과
// 데이터 소스(daily_work_status)는 같지만, "형명+몰드코드" 두 축이 아니라 **"형명+
// 몰드코드+지시도수" 세 축**으로 그룹핑해 조합마다 별도의 작은 표를 만든다(2026-08-26
// 사용자 요청, 참고 엑셀 도수분포분석.xlsx 구조 — 같은 형명·몰드코드 안에도 서로 다른
// 목표 파워가 섞여 있어 B.C/직경처럼 형명+몰드만 묶으면 구간 창보다 훨씬 넓게 흩어짐).
// 지시도수는 item_code 끝 4자리 숫자 세그먼트(×100)에서 추출한다(별도 규격 컬럼이
// 원본에 없음, "39A31-001-0300"→3.00D 식). bins는 그 표의 지시도수를 정중앙에 두고
// 좌우 5칸씩(1/8D 간격, 총 11칸) **내림차순**(왼쪽이 큰 값)으로 고정한다. rowKey는
// mode에 따라 "YYYY-MM"(요약/월별)/HEMA No(상세) 중 하나다.
export interface DosuDistributionRow {
  rowKey: string;
  /** 이 행의 유효 샘플 수(도수1/2/3 중 null·0이 아닌 값 합) */
  sampleCount: number;
  /** bins와 같은 길이 — 각 구간에 속한 샘플의 비율(%, 소수 첫째 자리) */
  values: number[];
  /** bins와 같은 길이 — 각 구간에 속한 샘플 수(원시 카운트) */
  counts: number[];
  /** 지시도수-0.625D(표시 범위 하한)보다 낮은 실측값이 있어 맨 오른쪽 칸에 몰아 넣었으면 true */
  lowerOverflow: boolean;
  /** 지시도수+0.625D(표시 범위 상한)보다 높은 실측값이 있어 맨 왼쪽 칸에 몰아 넣었으면 true */
  upperOverflow: boolean;
}
export interface DosuDistributionGroup {
  model: string;
  /** 몰드코드(dosu_change_status 조립투입품목 기준) */
  mold: string;
  /** 지시도수(목표 파워, item_code 끝 4자리 숫자 세그먼트에서 추출, ×100 값) */
  targetDosu: number;
  /** 1/8(0.125) 다이옵터 간격 구간 값 목록 — 지시도수가 정중앙(인덱스 5)에 오도록
   * 좌우 5칸씩, **내림차순**(왼쪽이 큰 값) 고정 11칸 */
  bins: number[];
  rows: DosuDistributionRow[];
}
export interface DosuDistributionResponse {
  groups: DosuDistributionGroup[];
}
export interface DosuDistributionFiltersResponse {
  models: string[];
  /** 몰드코드 목록 */
  molds: string[];
  /** 지시도수 목록(내림차순, 선택된 몰드코드+형명 안에 실제 존재하는 값만) */
  dosuOptions: number[];
}

// 생산관리 "일일작업현황(PROD-10)" — ERP 실적 로그 엑셀 업로드 스냅샷.
export interface DailyWorkStatusRow {
  id: number;
  /** "YYYY-MM-DD"로 정규화된 작업일자(필터/정렬용) */
  work_date: string | null;
  item_code: string | null;
  process_code: string | null;
  wo_no: string | null;
  lot_no: string | null;
  uploaded_at: string;
  /** 원본 엑셀 전체 컬럼(헤더명 → 값) */
  detail: Record<string, string | number | null> | null;
}

export interface DailyWorkStatusListResponse {
  rows: DailyWorkStatusRow[];
  total: number;
  page: number;
  pageSize: number;
  uploadedAt: string | null;
  /** 검색 필터가 적용된 전체 건에 대한 양품/불량수량 합계(현재 페이지가 아니라 전체 기준) */
  totals: Record<string, number>;
}

// 인원관리 "출퇴근카드등록(PSN-02)" — 카드 태깅 근태관리 시스템 원본 리포트 엑셀 업로드
// (기간별 누적). PSN-01(일일근태입력)과는 별개 데이터로 자동 연동되지 않는다.
export interface AttendanceCardRow {
  id: number;
  employee_no: string | null;
  /** "YYYY-MM-DD"로 정규화된 근무일자(필터/정렬용) */
  work_date: string | null;
  org: string | null;
  worker_name: string | null;
  team: string | null;
  uploaded_at: string;
  /** 원본 엑셀 전체 컬럼(헤더명 → 값) */
  detail: Record<string, string | number | null> | null;
}

export interface AttendanceCardListResponse {
  rows: AttendanceCardRow[];
  total: number;
  page: number;
  pageSize: number;
  uploadedAt: string | null;
}
